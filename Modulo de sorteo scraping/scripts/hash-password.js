const bcrypt = require('bcryptjs')

async function main() {
  const password = process.argv[2]
  if (!password) {
    console.error('Uso: npm run hash:password -- TU_PASSWORD')
    process.exit(1)
  }

  const hash = await bcrypt.hash(password, 10)
  console.log(hash)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
