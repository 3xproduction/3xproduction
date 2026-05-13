// Русские склонения по числительному.
// forms = [для 1, для 2-4, для 5+]
// pluralRu(1, ['заявка','заявки','заявок']) → 'заявка'
// pluralRu(3, ['заявка','заявки','заявок']) → 'заявки'
// pluralRu(5, ['заявка','заявки','заявок']) → 'заявок'
function pluralRu(n, forms) {
  const abs = Math.abs(Number(n) || 0)
  const mod100 = abs % 100
  const mod10 = abs % 10
  if (mod100 >= 11 && mod100 <= 14) return forms[2]
  if (mod10 === 1) return forms[0]
  if (mod10 >= 2 && mod10 <= 4) return forms[1]
  return forms[2]
}

module.exports = { pluralRu }
