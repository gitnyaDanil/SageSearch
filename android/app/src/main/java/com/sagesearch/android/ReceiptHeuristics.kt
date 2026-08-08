package com.sagesearch.android

import kotlin.math.min

object ReceiptHeuristics {
    private val receiptWords = Regex(
        "\\b(receipt|invoice|subtotal|total|tax|change|cash|visa|mastercard|qty|amount|" +
            "struk|nota|faktur|jumlah|tunai|kembali|ppn|harga|kasir|toko)\\b",
        RegexOption.IGNORE_CASE,
    )
    private val amountPattern = Regex(
        "(?i)(?:rp\\.?|idr|usd|\\$|€|£)?\\s*([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)",
    )
    private val totalLinePattern = Regex(
        "(?im)^.*\\b(?:grand\\s+total|total|jumlah|amount\\s+due)\\b.*$",
    )
    private val datePattern = Regex(
        "\\b(?:[0-3]?\\d[/-][01]?\\d[/-](?:19|20)?\\d{2}|(?:19|20)\\d{2}[/-][01]?\\d[/-][0-3]?\\d)\\b",
    )

    fun analyze(text: String): Pair<Double, ReceiptFields> {
        val normalized = text.trim()
        if (normalized.isEmpty()) return 0.0 to ReceiptFields()

        val wordHits = receiptWords.findAll(normalized).count()
        val amountHits = amountPattern.findAll(normalized).count()
        val lineCount = normalized.lineSequence().count { it.isNotBlank() }
        val hasTotal = totalLinePattern.containsMatchIn(normalized)

        var score = min(wordHits, 4) * 0.14
        score += min(amountHits, 3) * 0.08
        if (hasTotal) score += 0.18
        if (lineCount >= 4) score += 0.08
        score = score.coerceIn(0.0, 1.0)

        return score to extract(normalized)
    }

    private fun extract(text: String): ReceiptFields {
        val totalLine = totalLinePattern.findAll(text).lastOrNull()?.value
        val amountMatch = totalLine?.let { amountPattern.findAll(it).lastOrNull() }
            ?: amountPattern.findAll(text).lastOrNull()
        val totalText = amountMatch?.value?.trim()
        val currency = when {
            totalText?.contains("rp", ignoreCase = true) == true ||
                totalText?.contains("idr", ignoreCase = true) == true -> "IDR"
            totalText?.contains('$') == true || totalText?.contains("usd", ignoreCase = true) == true -> "USD"
            totalText?.contains('€') == true -> "EUR"
            totalText?.contains('£') == true -> "GBP"
            else -> null
        }

        val merchant = text.lineSequence()
            .map(String::trim)
            .firstOrNull { line ->
                line.length in 3..80 && !amountPattern.containsMatchIn(line) &&
                    !receiptWords.matches(line)
            }

        return ReceiptFields(
            merchantCandidate = merchant,
            transactionDateText = datePattern.find(text)?.value,
            totalText = totalText,
            total = totalText?.let(::parseAmount),
            currency = currency,
        )
    }

    internal fun parseAmount(raw: String): Double? {
        var numeric = raw.replace(Regex("[^0-9.,]"), "")
        if (numeric.isBlank()) return null

        val lastComma = numeric.lastIndexOf(',')
        val lastDot = numeric.lastIndexOf('.')
        val decimalIndex = maxOf(lastComma, lastDot)
        val digitsAfter = if (decimalIndex >= 0) numeric.length - decimalIndex - 1 else -1

        numeric = if (digitsAfter == 2) {
            val whole = numeric.substring(0, decimalIndex).replace(Regex("[.,]"), "")
            "$whole.${numeric.substring(decimalIndex + 1)}"
        } else {
            numeric.replace(Regex("[.,]"), "")
        }
        return numeric.toDoubleOrNull()
    }
}
