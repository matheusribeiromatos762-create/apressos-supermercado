const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error("ERRO: DATABASE_URL não configurada no Render");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function iniciarBanco() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      codigo TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      preco NUMERIC(10,2) NOT NULL,
      estoque INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Banco PostgreSQL conectado e tabela produtos pronta");
}

app.get("/api/produtos", async (req, res) => {
  try {
    const resultado = await pool.query(
      "SELECT id, codigo, nome, preco, estoque FROM produtos ORDER BY nome ASC"
    );

    res.json(resultado.rows);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

app.post("/api/produtos", async (req, res) => {
  try {
    const { codigo, nome, preco, estoque } = req.body;

    if (!codigo || !nome || preco === undefined || estoque === undefined) {
      return res.status(400).json({ erro: "Preencha todos os campos" });
    }

    const resultado = await pool.query(
      `
      INSERT INTO produtos (codigo, nome, preco, estoque)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [
        codigo.toUpperCase(),
        nome.toUpperCase(),
        Number(preco),
        Number(estoque)
      ]
    );

    res.json({
      sucesso: true,
      id: resultado.rows[0].id
    });
  } catch (erro) {
    if (erro.code === "23505") {
      return res.status(400).json({ erro: "Código de barras já cadastrado" });
    }

    res.status(500).json({ erro: erro.message });
  }
});

app.put("/api/produtos/:id", async (req, res) => {
  try {
    const { codigo, nome, preco, estoque } = req.body;

    if (!codigo || !nome || preco === undefined || estoque === undefined) {
      return res.status(400).json({ erro: "Preencha todos os campos" });
    }

    const resultado = await pool.query(
      `
      UPDATE produtos
      SET codigo = $1,
          nome = $2,
          preco = $3,
          estoque = $4
      WHERE id = $5
      RETURNING id
      `,
      [
        codigo.toUpperCase(),
        nome.toUpperCase(),
        Number(preco),
        Number(estoque),
        req.params.id
      ]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: "Produto não encontrado" });
    }

    res.json({ sucesso: true });
  } catch (erro) {
    if (erro.code === "23505") {
      return res.status(400).json({ erro: "Já existe outro produto com esse código" });
    }

    res.status(500).json({ erro: erro.message });
  }
});

app.delete("/api/produtos/:id", async (req, res) => {
  try {
    const resultado = await pool.query(
      "DELETE FROM produtos WHERE id = $1 RETURNING id",
      [req.params.id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: "Produto não encontrado" });
    }

    res.json({ sucesso: true });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

app.post("/api/venda", async (req, res) => {
  const client = await pool.connect();

  try {
    const { carrinho } = req.body;

    if (!carrinho || carrinho.length === 0) {
      return res.status(400).json({ erro: "Carrinho vazio" });
    }

    await client.query("BEGIN");

    for (const item of carrinho) {
      const resultado = await client.query(
        `
        SELECT nome, estoque
        FROM produtos
        WHERE codigo = $1
        FOR UPDATE
        `,
        [item.codigo]
      );

      if (resultado.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ erro: `Produto não encontrado: ${item.codigo}` });
      }

      const produto = resultado.rows[0];

      if (Number(produto.estoque) < Number(item.quantidade)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          erro: `Estoque insuficiente para ${produto.nome}`
        });
      }

      await client.query(
        `
        UPDATE produtos
        SET estoque = estoque - $1
        WHERE codigo = $2
        `,
        [Number(item.quantidade), item.codigo]
      );
    }

    await client.query("COMMIT");

    res.json({ sucesso: true });
  } catch (erro) {
    await client.query("ROLLBACK");
    res.status(500).json({ erro: erro.message });
  } finally {
    client.release();
  }
});

iniciarBanco()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log("====================================");
      console.log("APRESSOS SUPERMERCADO ONLINE");
      console.log("Banco: Neon PostgreSQL");
      console.log(`Servidor rodando na porta ${PORT}`);
      console.log("====================================");
    });
  })
  .catch((erro) => {
    console.error("Erro ao iniciar banco:", erro);
    process.exit(1);
  });
