const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("./database.db");

db.run(`
  CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL,
    preco REAL NOT NULL,
    estoque INTEGER NOT NULL
  )
`);

app.get("/api/produtos", (req, res) => {
  db.all("SELECT * FROM produtos ORDER BY nome ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ erro: err.message });
    res.json(rows);
  });
});

app.post("/api/produtos", (req, res) => {
  const { codigo, nome, preco, estoque } = req.body;

  if (!codigo || !nome || preco === undefined || estoque === undefined) {
    return res.status(400).json({ erro: "Preencha todos os campos" });
  }

  db.run(
    "INSERT INTO produtos (codigo, nome, preco, estoque) VALUES (?, ?, ?, ?)",
    [
      codigo.toUpperCase(),
      nome.toUpperCase(),
      Number(preco),
      Number(estoque)
    ],
    function (err) {
      if (err) {
        return res.status(400).json({ erro: "Código de barras já cadastrado" });
      }

      res.json({ sucesso: true, id: this.lastID });
    }
  );
});

app.put("/api/produtos/:id", (req, res) => {
  const { codigo, nome, preco, estoque } = req.body;

  if (!codigo || !nome || preco === undefined || estoque === undefined) {
    return res.status(400).json({ erro: "Preencha todos os campos" });
  }

  db.run(
    "UPDATE produtos SET codigo = ?, nome = ?, preco = ?, estoque = ? WHERE id = ?",
    [
      codigo.toUpperCase(),
      nome.toUpperCase(),
      Number(preco),
      Number(estoque),
      req.params.id
    ],
    function (err) {
      if (err) return res.status(400).json({ erro: err.message });
      res.json({ sucesso: true });
    }
  );
});

app.delete("/api/produtos/:id", (req, res) => {
  db.run("DELETE FROM produtos WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ erro: err.message });
    res.json({ sucesso: true });
  });
});

app.post("/api/venda", (req, res) => {
  const { carrinho } = req.body;

  if (!carrinho || carrinho.length === 0) {
    return res.status(400).json({ erro: "Carrinho vazio" });
  }

  db.serialize(() => {
    carrinho.forEach(item => {
      db.run(
        "UPDATE produtos SET estoque = estoque - ? WHERE codigo = ?",
        [Number(item.quantidade), item.codigo]
      );
    });

    res.json({ sucesso: true });
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("====================================");
  console.log("APRESSOS SUPERMERCADO ONLINE");
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log("====================================");
});
