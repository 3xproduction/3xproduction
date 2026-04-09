const { PDFDocument, rgb } = require('pdf-lib')
const fontkit = require('@pdf-lib/fontkit')
const fs = require('fs')
const path = require('path')

const ROBOTO_REG  = fs.readFileSync(path.join(__dirname, '../assets/Roboto-Regular.ttf'))
const ROBOTO_BOLD = fs.readFileSync(path.join(__dirname, '../assets/Roboto-Bold.ttf'))

async function embedFonts(doc) {
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(ROBOTO_REG)
  const bold = await doc.embedFont(ROBOTO_BOLD)
  return { font, bold }
}

function drawStamp(page, font, bold, x, y, name) {
  // Blue bordered stamp with name
  page.drawRectangle({ x, y, width: 200, height: 50, borderColor: rgb(0.2, 0.4, 0.7), borderWidth: 1.5, color: rgb(0.95, 0.97, 1) })
  page.drawText(String(name || 'Склад'), { x: x + 10, y: y + 30, size: 10, font: bold, color: rgb(0.2, 0.4, 0.7) })
  page.drawText('Подпись / Штамп', { x: x + 10, y: y + 12, size: 8, font, color: rgb(0.5, 0.6, 0.7) })
}

async function embedSig(doc, page, dataUrl, x, y, w = 220, h = 60) {
  if (!dataUrl) return
  try {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const imgBytes = Buffer.from(base64, 'base64')
    const img = await doc.embedPng(imgBytes).catch(() => doc.embedJpg(imgBytes))
    page.drawImage(img, { x, y: y - h, width: w, height: h })
  } catch {}
}

async function createIssuancePDF({ issuedTo, issuedBy, deadline, signatureDataUrl, issuerSignatureDataUrl, issuerStamp, items, receiverRole, receiverContact, projectName, issuerRole }) {
  const doc  = await PDFDocument.create()
  const page = doc.addPage([595, 842]) // A4
  const { font, bold } = await embedFonts(doc)
  const { height } = page.getSize()

  let y = height - 60

  function text(str, x, yy, opts = {}) {
    page.drawText(String(str), {
      x, y: yy,
      size: opts.size || 11,
      font: opts.bold ? bold : font,
      color: opts.color || rgb(0.07, 0.07, 0.07),
      maxWidth: opts.maxWidth,
    })
  }

  function line(y1) {
    page.drawLine({ start: { x: 50, y: y1 }, end: { x: 545, y: y1 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) })
  }

  // Header
  text('АКТ ВЫДАЧИ ИМУЩЕСТВА', 50, y, { bold: true, size: 16 })
  y -= 24
  text(`Дата: ${new Date().toLocaleDateString('ru-RU')}   Срок возврата: ${deadline}`, 50, y, { size: 10, color: rgb(0.5, 0.5, 0.5) })
  y -= 30; line(y); y -= 20

  // Parties
  text('Выдал:', 50, y, { bold: true }); text(issuedBy, 130, y)
  if (issuerRole) { text(`(${issuerRole})`, 130 + font.widthOfTextAtSize(issuedBy, 11) + 6, y, { size: 9, color: rgb(0.5, 0.5, 0.5) }) }
  y -= 18
  text('Получил:', 50, y, { bold: true }); text(issuedTo, 130, y)
  if (receiverRole) { text(`(${receiverRole})`, 130 + font.widthOfTextAtSize(issuedTo, 11) + 6, y, { size: 9, color: rgb(0.5, 0.5, 0.5) }) }
  y -= 18
  if (projectName) { text('Проект:', 50, y, { bold: true }); text(projectName, 130, y); y -= 18 }
  if (receiverContact) { text('Контакт:', 50, y, { bold: true }); text(receiverContact, 130, y); y -= 18 }
  y -= 12; line(y); y -= 20

  // Items table header
  text('№', 50, y, { bold: true, size: 10 })
  text('Наименование', 75, y, { bold: true, size: 10 })
  text('Инв. №', 320, y, { bold: true, size: 10 })
  text('Кол-во', 460, y, { bold: true, size: 10 })
  y -= 6; line(y); y -= 16

  // Items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    text(String(i + 1), 50, y, { size: 10 })
    text(item.name, 75, y, { size: 10, maxWidth: 230 })
    text(item.serial || String(i + 1), 320, y, { size: 10 })
    text(String(item.qty || 1), 460, y, { size: 10 })
    y -= 18
  }

  y -= 10; line(y); y -= 30

  // Agreement
  text('Соглашение об ответственности', 50, y, { bold: true })
  y -= 16
  const agreementText = 'Получатель принимает на себя полную материальную ответственность за сохранность перечисленного имущества и обязуется вернуть его в надлежащем состоянии в указанный срок.'
  text(agreementText, 50, y, { size: 9, color: rgb(0.4, 0.4, 0.4), maxWidth: 495 })
  y -= 50

  // Signatures — both parties
  text('Подпись получателя:', 50, y + 5, { size: 9, color: rgb(0.5, 0.5, 0.5) })
  text('Подпись выдавшего:', 310, y + 5, { size: 9, color: rgb(0.5, 0.5, 0.5) })
  await embedSig(doc, page, signatureDataUrl, 50, y, 240, 70)
  if (issuerSignatureDataUrl) {
    await embedSig(doc, page, issuerSignatureDataUrl, 310, y, 240, 70)
  } else if (issuerStamp || !issuerSignatureDataUrl) {
    drawStamp(page, font, bold, 310, y - 50, issuedBy)
  }

  return doc.save()
}

async function createReturnPDF({ items, returnedBy, acceptedBy, conditionNotes, signatureDataUrl, returnerSignatureDataUrl, returnerRole, returnerContact, projectName, acceptorRole }) {
  const doc  = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const { font, bold } = await embedFonts(doc)
  const { height } = page.getSize()

  let y = height - 60

  function text(str, x, yy, opts = {}) {
    page.drawText(String(str), { x, y: yy, size: opts.size || 11, font: opts.bold ? bold : font, color: opts.color || rgb(0.07, 0.07, 0.07), maxWidth: opts.maxWidth })
  }
  function line(y1) {
    page.drawLine({ start: { x: 50, y: y1 }, end: { x: 545, y: y1 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) })
  }

  text('АКТ ВОЗВРАТА ИМУЩЕСТВА', 50, y, { bold: true, size: 16 })
  y -= 24
  text(`Дата возврата: ${new Date().toLocaleDateString('ru-RU')}`, 50, y, { size: 10, color: rgb(0.5, 0.5, 0.5) })
  y -= 30; line(y); y -= 20

  text('Сдал:', 50, y, { bold: true }); text(returnedBy, 120, y)
  if (returnerRole) { text(`(${returnerRole})`, 120 + font.widthOfTextAtSize(returnedBy, 11) + 6, y, { size: 9, color: rgb(0.5, 0.5, 0.5) }) }
  y -= 18
  text('Принял:', 50, y, { bold: true }); text(acceptedBy, 120, y)
  if (acceptorRole) { text(`(${acceptorRole})`, 120 + font.widthOfTextAtSize(acceptedBy, 11) + 6, y, { size: 9, color: rgb(0.5, 0.5, 0.5) }) }
  y -= 18
  if (projectName) { text('Проект:', 50, y, { bold: true }); text(projectName, 120, y); y -= 18 }
  if (returnerContact) { text('Контакт:', 50, y, { bold: true }); text(returnerContact, 120, y); y -= 18 }
  y -= 12; line(y); y -= 20

  text('№', 50, y, { bold: true, size: 10 })
  text('Наименование', 75, y, { bold: true, size: 10 })
  text('Инв. №', 300, y, { bold: true, size: 10 })
  text('Состояние', 430, y, { bold: true, size: 10 })
  y -= 6; line(y); y -= 16

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    text(String(i + 1), 50, y, { size: 10 })
    text(item.name, 75, y, { size: 10, maxWidth: 210 })
    text(item.serial || String(i + 1), 300, y, { size: 10 })
    text(item.condition || 'Не указано', 430, y, { size: 10 })
    y -= 18
  }

  if (conditionNotes) {
    y -= 10; line(y); y -= 20
    text('Примечания по состоянию:', 50, y, { bold: true })
    y -= 16
    text(conditionNotes, 50, y, { size: 10, color: rgb(0.4, 0.4, 0.4), maxWidth: 495 })
    y -= 30
  }

  y -= 20
  // Signatures — both parties
  text('Подпись сдавшего:', 50, y + 5, { size: 9, color: rgb(0.5, 0.5, 0.5) })
  text('Подпись принимающего:', 310, y + 5, { size: 9, color: rgb(0.5, 0.5, 0.5) })
  if (returnerSignatureDataUrl) {
    await embedSig(doc, page, returnerSignatureDataUrl, 50, y, 240, 70)
  } else {
    drawStamp(page, font, bold, 50, y - 50, returnedBy)
  }
  if (signatureDataUrl) {
    await embedSig(doc, page, signatureDataUrl, 310, y, 240, 70)
  } else {
    drawStamp(page, font, bold, 310, y - 50, acceptedBy)
  }

  return doc.save()
}

async function createExtensionPDF({ items, newDeadline, initiatorName, acceptorName, initiatorSig, acceptorSig }) {
  const doc  = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const { font, bold } = await embedFonts(doc)
  const { height } = page.getSize()
  let y = height - 60

  function text(str, x, yy, opts = {}) {
    page.drawText(String(str), { x, y: yy, size: opts.size || 11, font: opts.bold ? bold : font, color: opts.color || rgb(0.07, 0.07, 0.07), maxWidth: opts.maxWidth })
  }
  function line(y1) {
    page.drawLine({ start: { x: 50, y: y1 }, end: { x: 545, y: y1 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) })
  }

  text('АКТ ПРОДЛЕНИЯ', 50, y, { bold: true, size: 16 })
  y -= 24
  text(`Дата: ${new Date().toLocaleDateString('ru-RU')}   Новый дедлайн: ${newDeadline}`, 50, y, { size: 10, color: rgb(0.5, 0.5, 0.5) })
  y -= 30; line(y); y -= 20

  text('Инициатор:', 50, y, { bold: true }); text(initiatorName, 140, y)
  y -= 18
  text('Принял:', 50, y, { bold: true }); text(acceptorName, 140, y)
  y -= 30; line(y); y -= 20

  text('Единицы:', 50, y, { bold: true })
  y -= 16
  for (const item of items) {
    text(`• ${item.name} (${item.serial || '—'})`, 60, y, { size: 10 })
    y -= 16
  }

  y -= 20
  text('Подпись инициатора:', 50, y + 5, { size: 9, color: rgb(0.5, 0.5, 0.5) })
  text('Подпись принимающего:', 310, y + 5, { size: 9, color: rgb(0.5, 0.5, 0.5) })

  await embedSig(doc, page, initiatorSig, 50, y)
  await embedSig(doc, page, acceptorSig, 310, y)

  return doc.save()
}

module.exports = { createIssuancePDF, createReturnPDF, createExtensionPDF }
