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
  ssl: { rejectUnauthorized: false }
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas (
      id SERIAL PRIMARY KEY,
      total NUMERIC(10,2) NOT NULL,
      criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS venda_itens (
      id SERIAL PRIMARY KEY,
      venda_id INTEGER REFERENCES vendas(id) ON DELETE CASCADE,
      produto_id INTEGER REFERENCES produtos(id),
      codigo TEXT NOT NULL,
      nome TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      preco_unitario NUMERIC(10,2) NOT NULL,
      total_item NUMERIC(10,2) NOT NULL
    )
  `);

  console.log("Banco PostgreSQL conectado e tabelas prontas");
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
      [codigo.toUpperCase(), nome.toUpperCase(), Number(preco), Number(estoque)]
    );

    res.json({ sucesso: true, id: resultado.rows[0].id });
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
      SET codigo = $1, nome = $2, preco = $3, estoque = $4
      WHERE id = $5
      RETURNING id
      `,
      [codigo.toUpperCase(), nome.toUpperCase(), Number(preco), Number(estoque), req.params.id]
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

    let totalVenda = 0;
    const itensProcessados = [];

    for (const item of carrinho) {
      const resultado = await client.query(
        `
        SELECT id, codigo, nome, preco, estoque
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
        return res.status(400).json({ erro: `Estoque insuficiente para ${produto.nome}` });
      }

      const totalItem = Number(produto.preco) * Number(item.quantidade);
      totalVenda += totalItem;

      itensProcessados.push({
        produto_id: produto.id,
        codigo: produto.codigo,
        nome: produto.nome,
        quantidade: Number(item.quantidade),
        preco_unitario: Number(produto.preco),
        total_item: totalItem
      });

      await client.query(
        "UPDATE produtos SET estoque = estoque - $1 WHERE codigo = $2",
        [Number(item.quantidade), item.codigo]
      );
    }

    const venda = await client.query(
      "INSERT INTO vendas (total) VALUES ($1) RETURNING id",
      [totalVenda]
    );

    const vendaId = venda.rows[0].id;

    for (const item of itensProcessados) {
      await client.query(
        `
        INSERT INTO venda_itens
        (venda_id, produto_id, codigo, nome, quantidade, preco_unitario, total_item)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          vendaId,
          item.produto_id,
          item.codigo,
          item.nome,
          item.quantidade,
          item.preco_unitario,
          item.total_item
        ]
      );
    }

    await client.query("COMMIT");

    res.json({ sucesso: true, venda_id: vendaId, total: totalVenda });
  } catch (erro) {
    await client.query("ROLLBACK");
    res.status(500).json({ erro: erro.message });
  } finally {
    client.release();
  }
});

app.get("/api/relatorios/:periodo", async (req, res) => {
  try {
    const { periodo } = req.params;

    let filtro = "";

    if (periodo === "dia") {
      filtro = "WHERE criada_em >= date_trunc('day', CURRENT_TIMESTAMP)";
    } else if (periodo === "mes") {
      filtro = "WHERE criada_em >= date_trunc('month', CURRENT_TIMESTAMP)";
    } else if (periodo === "ano") {
      filtro = "WHERE criada_em >= date_trunc('year', CURRENT_TIMESTAMP)";
    } else {
      return res.status(400).json({ erro: "Período inválido" });
    }

    const resumo = await pool.query(`
      SELECT 
        COUNT(*)::INTEGER AS quantidade_vendas,
        COALESCE(SUM(total), 0)::NUMERIC(10,2) AS total_vendido
      FROM vendas
      ${filtro}
    `);

    const itens = await pool.query(`
      SELECT 
        COALESCE(SUM(vi.quantidade), 0)::INTEGER AS quantidade_itens
      FROM venda_itens vi
      JOIN vendas v ON v.id = vi.venda_id
      ${filtro.replace("criada_em", "v.criada_em")}
    `);

    const maisVendidos = await pool.query(`
      SELECT 
        vi.codigo,
        vi.nome,
        SUM(vi.quantidade)::INTEGER AS quantidade,
        SUM(vi.total_item)::NUMERIC(10,2) AS total
      FROM venda_itens vi
      JOIN vendas v ON v.id = vi.venda_id
      ${filtro.replace("criada_em", "v.criada_em")}
      GROUP BY vi.codigo, vi.nome
      ORDER BY quantidade DESC
      LIMIT 10
    `);

    const vendas = await pool.query(`
      SELECT 
        id,
        total,
        criada_em
      FROM vendas
      ${filtro}
      ORDER BY criada_em DESC
      LIMIT 50
    `);

    res.json({
      periodo,
      quantidade_vendas: resumo.rows[0].quantidade_vendas,
      total_vendido: resumo.rows[0].total_vendido,
      quantidade_itens: itens.rows[0].quantidade_itens,
      produtos_mais_vendidos: maisVendidos.rows,
      ultimas_vendas: vendas.rows
    });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

iniciarBanco()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log("====================================");
      console.log("APRESSOS ONLINE");
      console.log("Banco: Neon PostgreSQL");
      console.log(`Servidor rodando na porta ${PORT}`);
      console.log("====================================");
    });
  })
  .catch((erro) => {
    console.error("Erro ao iniciar banco:", erro);
    process.exit(1);
  });
