package com.sagesearch.android

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert

@Entity(
    tableName = "indexed_images",
    indices = [Index(value = ["analyzedAtMillis"])],
)
data class IndexedImage(
    @PrimaryKey val imageUri: String,
    val analyzedAtMillis: Long,
    val contentKind: String,
    val receiptConfidence: Double,
    val ocrText: String,
    val merchantCandidate: String?,
    val transactionDateText: String?,
    val totalText: String?,
    val total: Double?,
    val currency: String?,
) {
    fun toAnalysisResult() = ImageAnalysisResult(
        contentKind = contentKind,
        receiptConfidence = receiptConfidence,
        ocrText = ocrText,
        receipt = ReceiptFields(
            merchantCandidate = merchantCandidate,
            transactionDateText = transactionDateText,
            totalText = totalText,
            total = total,
            currency = currency,
        ),
    )

    companion object {
        fun from(imageUri: String, result: ImageAnalysisResult) = IndexedImage(
            imageUri = imageUri,
            analyzedAtMillis = System.currentTimeMillis(),
            contentKind = result.contentKind,
            receiptConfidence = result.receiptConfidence,
            ocrText = result.ocrText,
            merchantCandidate = result.receipt.merchantCandidate,
            transactionDateText = result.receipt.transactionDateText,
            totalText = result.receipt.totalText,
            total = result.receipt.total,
            currency = result.receipt.currency,
        )
    }
}

@Dao
interface IndexedImageDao {
    @Upsert
    suspend fun upsert(image: IndexedImage)

    @Query("SELECT COUNT(*) FROM indexed_images")
    suspend fun count(): Int

    @Query(
        """
        SELECT * FROM indexed_images
        WHERE :query = ''
           OR ocrText LIKE '%' || :query || '%' COLLATE NOCASE
           OR merchantCandidate LIKE '%' || :query || '%' COLLATE NOCASE
           OR transactionDateText LIKE '%' || :query || '%' COLLATE NOCASE
           OR totalText LIKE '%' || :query || '%' COLLATE NOCASE
           OR currency LIKE '%' || :query || '%' COLLATE NOCASE
        ORDER BY analyzedAtMillis DESC
        LIMIT 40
        """,
    )
    suspend fun search(query: String): List<IndexedImage>
}

@Database(entities = [IndexedImage::class], version = 1, exportSchema = false)
abstract class ImageIndexDatabase : RoomDatabase() {
    abstract fun indexedImageDao(): IndexedImageDao

    companion object {
        @Volatile
        private var instance: ImageIndexDatabase? = null

        fun get(context: Context): ImageIndexDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                ImageIndexDatabase::class.java,
                "sagesearch-image-index.db",
            ).build().also { instance = it }
        }
    }
}
