require("dotenv").config()
const mysql = require("mysql2/promise")

async function test() {
  const configs = [
    { host: "193.203.175.35", label: "IP directa" },
    { host: "srv1183.hstgr.io", label: "hostname" },
    { host: "193.203.175.35", port: 3307, label: "IP:3307" },
  ]

  for (const cfg of configs) {
    try {
      const conn = await mysql.createConnection({
        host: cfg.host,
        user: "u692901087_Scraping_lote",
        password: "Matias4315.",
        database: "u692901087_Scraping_lote",
        port: 3306,
        connectTimeout: 10000,
      })
      console.log(`✅ Conectado con ${cfg.label}: ${cfg.host}`)
      const [tables] = await conn.query("SHOW TABLES")
      console.log("  Tablas existentes:", tables.map(t => Object.values(t)[0]))
      if (tables.length === 0) {
        console.log("  (vacía — hay que crear tablas)")
      } else {
        for (const t of tables) {
          const tn = Object.values(t)[0]
          const [cols] = await conn.query("DESCRIBE `" + tn + "`")
          console.log(`  ${tn}:`, cols.map(c => c.Field + " " + c.Type).join(", "))
          const [rows] = await conn.query("SELECT * FROM `" + tn + "` LIMIT 3")
          console.log(`  datos:`, JSON.stringify(rows))
        }
      }
      await conn.end()
      return // si conectó con uno, no hace falta probar el otro
    } catch (e) {
      console.log(`❌ ${cfg.label} (${cfg.host}): ${e.message}`)
    }
  }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
