from __future__ import annotations

import json
import mimetypes
import socket
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "estoque.db"
HOST = "0.0.0.0"
PORT = 8000


class InventoryError(Exception):
	pass


def connect() -> sqlite3.Connection:
	connection = sqlite3.connect(DATABASE, timeout=10)
	connection.row_factory = sqlite3.Row
	connection.execute("PRAGMA foreign_keys = ON")
	return connection


def initialize_database() -> None:
	with connect() as connection:
		connection.executescript(
			"""
			CREATE TABLE IF NOT EXISTS products (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				sku TEXT UNIQUE,
				category TEXT NOT NULL DEFAULT '',
				quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
				minimum_quantity INTEGER NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
				created_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS movements (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				product_id INTEGER NOT NULL REFERENCES products(id),
				movement_type TEXT NOT NULL CHECK (movement_type IN ('entry', 'exit')),
				quantity INTEGER NOT NULL CHECK (quantity > 0),
				note TEXT NOT NULL DEFAULT '',
				occurred_at TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
			"""
		)
	seed_products_from_json()


def seed_products_from_json() -> None:
	sample_file = ROOT / "dados_exemplo.json"
	with sample_file.open(encoding="utf-8") as file:
		products = json.load(file)
	if not isinstance(products, list):
		raise ValueError("dados_exemplo.json deve conter uma lista de produtos.")

	with connect() as connection:
		if connection.execute("SELECT COUNT(*) FROM products").fetchone()[0] > 0:
			return

	for product in products:
		if not isinstance(product, dict):
			raise ValueError("Cada item de dados_exemplo.json deve ser um objeto.")
		create_product(product)


def parse_nonnegative_integer(value: object, field: str) -> int:
	if isinstance(value, bool):
		raise InventoryError(f"Informe um valor válido para {field}.")
	try:
		number = int(value)  # type: ignore[arg-type]
	except (TypeError, ValueError):
		raise InventoryError(f"Informe um valor válido para {field}.") from None
	if number < 0 or str(number) != str(value).strip():
		raise InventoryError(f"{field.capitalize()} deve ser um número inteiro igual ou maior que zero.")
	return number


def parse_movement_date(value: object) -> str:
	if not value:
		return datetime.now().astimezone().isoformat(timespec="minutes")
	try:
		return datetime.fromisoformat(str(value)).isoformat(timespec="minutes")
	except ValueError:
		raise InventoryError("Informe uma data e hora válidas para a movimentação.") from None


def create_product(data: dict[str, object]) -> int:
	name = str(data.get("name", "")).strip()
	if not name:
		raise InventoryError("Informe o nome do produto.")
	initial_quantity = parse_nonnegative_integer(data.get("initial_quantity", 0), "estoque inicial")
	minimum_quantity = parse_nonnegative_integer(data.get("minimum_quantity", 0), "estoque mínimo")
	sku = str(data.get("sku", "")).strip() or None
	category = str(data.get("category", "")).strip()
	now = datetime.now().astimezone().isoformat(timespec="minutes")

	try:
		with connect() as connection:
			cursor = connection.execute(
				"""INSERT INTO products (name, sku, category, quantity, minimum_quantity, created_at)
				   VALUES (?, ?, ?, ?, ?, ?)""",
				(name, sku, category, initial_quantity, minimum_quantity, now),
			)
			product_id = cursor.lastrowid
			if initial_quantity:
				connection.execute(
					"""INSERT INTO movements
					   (product_id, movement_type, quantity, note, occurred_at, created_at)
					   VALUES (?, 'entry', ?, 'Estoque inicial', ?, ?)""",
					(product_id, initial_quantity, now, now),
				)
			return int(product_id)
	except sqlite3.IntegrityError as error:
		if "products.sku" in str(error):
			raise InventoryError("Esse código já está sendo usado por outro produto.") from None
		raise


def register_movement(data: dict[str, object]) -> dict[str, object]:
	product_id = parse_nonnegative_integer(data.get("product_id"), "produto")
	quantity = parse_nonnegative_integer(data.get("quantity"), "quantidade")
	movement_type = str(data.get("movement_type", ""))
	if movement_type not in {"entry", "exit"}:
		raise InventoryError("Selecione entrada ou saída.")
	if quantity < 1:
		raise InventoryError("A quantidade deve ser maior que zero.")

	occurred_at = parse_movement_date(data.get("occurred_at"))
	created_at = datetime.now().astimezone().isoformat(timespec="minutes")
	note = str(data.get("note", "")).strip()

	with connect() as connection:
		connection.execute("BEGIN IMMEDIATE")
		product = connection.execute(
			"SELECT id, name, quantity FROM products WHERE id = ?", (product_id,)
		).fetchone()
		if product is None:
			raise InventoryError("Produto não encontrado. Atualize a página e tente novamente.")

		current_quantity = int(product["quantity"])
		if movement_type == "exit" and quantity > current_quantity:
			raise InventoryError(f"Saldo insuficiente. Há apenas {current_quantity} unidade(s) disponíveis.")

		adjustment = quantity if movement_type == "entry" else -quantity
		new_quantity = current_quantity + adjustment
		connection.execute("UPDATE products SET quantity = ? WHERE id = ?", (new_quantity, product_id))
		connection.execute(
			"""INSERT INTO movements
			   (product_id, movement_type, quantity, note, occurred_at, created_at)
			   VALUES (?, ?, ?, ?, ?, ?)""",
			(product_id, movement_type, quantity, note, occurred_at, created_at),
		)
		return {
			"product_name": str(product["name"]),
			"quantity": new_quantity,
			"is_empty": new_quantity == 0,
		}


def dashboard_data() -> dict[str, object]:
	with connect() as connection:
		products = [
			dict(row)
			for row in connection.execute(
				"SELECT * FROM products ORDER BY name COLLATE NOCASE"
			).fetchall()
		]
		movements = [
			dict(row)
			for row in connection.execute(
				"""SELECT m.id, m.product_id, p.name AS product_name, p.sku,
						  m.movement_type, m.quantity, m.note, m.occurred_at
				   FROM movements AS m JOIN products AS p ON p.id = m.product_id
				   ORDER BY m.occurred_at DESC, m.id DESC LIMIT 10"""
			).fetchall()
		]

	alerts = [
		{"id": item["id"], "name": item["name"], "quantity": item["quantity"],
		 "minimum_quantity": item["minimum_quantity"]}
		for item in products
		if item["quantity"] <= item["minimum_quantity"]
	]
	return {
		"products": products,
		"movements": movements,
		"alerts": alerts,
		"summary": {
			"product_count": len(products),
			"unit_count": sum(item["quantity"] for item in products),
			"low_stock_count": len(alerts),
			"empty_count": sum(item["quantity"] == 0 for item in products),
		},
	}


class InventoryHandler(BaseHTTPRequestHandler):
	def send_json(self, payload: object, status: int = 200) -> None:
		encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
		self.send_response(status)
		self.send_header("Content-Type", "application/json; charset=utf-8")
		self.send_header("Content-Length", str(len(encoded)))
		self.send_header("Cache-Control", "no-store")
		self.end_headers()
		self.wfile.write(encoded)

	def read_json(self) -> dict[str, object]:
		try:
			length = int(self.headers.get("Content-Length", "0"))
			if length > 100_000:
				raise InventoryError("A solicitação é grande demais.")
			data = json.loads(self.rfile.read(length))
		except (ValueError, json.JSONDecodeError):
			raise InventoryError("Não foi possível ler os dados enviados.") from None
		if not isinstance(data, dict):
			raise InventoryError("Os dados enviados são inválidos.")
		return data

	def do_GET(self) -> None:
		path = urlparse(self.path).path
		if path == "/":
			self.serve_file(ROOT / "templates" / "index.html")
		elif path == "/api/dashboard":
			self.send_json(dashboard_data())
		elif path.startswith("/static/"):
			relative = Path(path.removeprefix("/static/"))
			candidate = (ROOT / "static" / relative).resolve()
			try:
				candidate.relative_to((ROOT / "static").resolve())
			except ValueError:
				self.send_error(404)
				return
			self.serve_file(candidate)
		else:
			self.send_error(404)

	def do_POST(self) -> None:
		path = urlparse(self.path).path
		try:
			data = self.read_json()
			if path == "/api/products":
				product_id = create_product(data)
				self.send_json({"id": product_id}, 201)
			elif path == "/api/movements":
				self.send_json(register_movement(data), 201)
			else:
				self.send_error(404)
		except InventoryError as error:
			self.send_json({"error": str(error)}, 400)
		except sqlite3.IntegrityError:
			self.send_json({"error": "Não foi possível salvar os dados informados."}, 400)
		except Exception:
			self.log_error("Falha ao processar %s", path)
			self.send_json({"error": "Erro interno ao salvar. Verifique o terminal do servidor."}, 500)

	def serve_file(self, path: Path) -> None:
		if not path.is_file():
			self.send_error(404)
			return
		content = path.read_bytes()
		content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
		self.send_response(200)
		self.send_header("Content-Type", f"{content_type}; charset=utf-8")
		self.send_header("Content-Length", str(len(content)))
		self.end_headers()
		self.wfile.write(content)


if __name__ == "__main__":
	initialize_database()
	server = ThreadingHTTPServer((HOST, PORT), InventoryHandler)
	print(f"Sistema de estoque escutando na porta {PORT}.")
	addresses = {
		info[4][0]
		for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
		if not info[4][0].startswith("127.")
	}
	if addresses:
		for address in sorted(addresses):
			print(f"Acesso na rede: http://{address}:{PORT}")
	else:
		print("Consulte o IPv4 deste computador com o comando ipconfig.")
	try:
		server.serve_forever()
	except KeyboardInterrupt:
		print("\nServidor encerrado.")
	finally:
		server.server_close()
