package com.sagesearch.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiptHeuristicsTest {
    @Test
    fun detectsIndonesianReceiptAndExtractsTotal() {
        val text = """
            TOKO MAJU
            08/08/2026
            Kopi       Rp 25.000
            Subtotal   Rp 25.000
            PPN        Rp 2.750
            TOTAL      Rp 27.750
            Tunai      Rp 30.000
            Kembali    Rp 2.250
        """.trimIndent()

        val (confidence, receipt) = ReceiptHeuristics.analyze(text)

        assertTrue(confidence >= 0.45)
        assertEquals("TOKO MAJU", receipt.merchantCandidate)
        assertEquals("RP 27.750", receipt.totalText?.uppercase())
        assertEquals(27750.0, receipt.total ?: 0.0, 0.001)
        assertEquals("IDR", receipt.currency)
        assertEquals("08/08/2026", receipt.transactionDateText)
    }

    @Test
    fun treatsLandscapeCaptionAsPicture() {
        val (confidence, _) = ReceiptHeuristics.analyze("Sunset over the mountain")
        assertTrue(confidence < 0.45)
    }
}
