package com.sagesearch.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    ReceiptTestScreen()
                }
            }
        }
    }
}

@Composable
private fun ReceiptTestScreen() {
    val context = LocalContext.current
    val analyzer = remember { AndroidOcrAnalyzer(context.applicationContext) }
    val imageDao = remember { ImageIndexDatabase.get(context).indexedImageDao() }
    val coroutineScope = rememberCoroutineScope()
    var state: AnalysisUiState by remember { mutableStateOf(AnalysisUiState.Idle) }
    var indexedCount by remember { mutableStateOf(0) }
    var indexMessage by remember { mutableStateOf<String?>(null) }
    var searchQuery by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<IndexedImage>>(emptyList()) }

    suspend fun refreshIndex() {
        indexedCount = imageDao.count()
        searchResults = imageDao.search(searchQuery.trim())
    }

    LaunchedEffect(imageDao) {
        refreshIndex()
    }

    val picker = rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
        if (uri != null) {
            state = AnalysisUiState.Analyzing
            indexMessage = null
            analyzer.analyze(
                uri = uri,
                onSuccess = { result ->
                    state = AnalysisUiState.Success(result)
                    coroutineScope.launch {
                        runCatching {
                            imageDao.upsert(IndexedImage.from(uri.toString(), result))
                            refreshIndex()
                        }.onSuccess {
                            indexMessage = "Saved to the local image index."
                        }.onFailure { error ->
                            indexMessage = "Analysis succeeded, but could not be saved: ${error.message}"
                        }
                    }
                },
                onError = { state = AnalysisUiState.Error(it.message ?: "OCR failed") },
            )
        }
    }

    DisposableEffect(analyzer) {
        onDispose { analyzer.close() }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("SageSearch image test", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Choose one receipt or photo. OCR and receipt detection run on this device; " +
                "the prototype does not upload the image or request full gallery access.",
        )
        Button(
            onClick = {
                picker.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly))
            },
            enabled = state !is AnalysisUiState.Analyzing,
        ) {
            Text(if (state is AnalysisUiState.Analyzing) "Analyzing…" else "Choose an image")
        }

        when (val current = state) {
            AnalysisUiState.Idle -> Text("Tip: start with a clear, upright receipt in Latin script.")
            AnalysisUiState.Analyzing -> Text("Running on-device text recognition…")
            is AnalysisUiState.Error -> Text(
                "Could not analyze the image: ${current.message}",
                color = MaterialTheme.colorScheme.error,
            )
            is AnalysisUiState.Success -> AnalysisCard(current.result)
        }

        indexMessage?.let { Text(it) }

        Text("Local image index", style = MaterialTheme.typography.headlineSmall)
        Text("$indexedCount manually analyzed image${if (indexedCount == 1) "" else "s"} saved on this device.")
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Search saved visible text or receipt fields") },
            singleLine = true,
        )
        Button(
            onClick = {
                coroutineScope.launch {
                    runCatching { refreshIndex() }
                        .onFailure { indexMessage = "Search failed: ${it.message}" }
                }
            },
            enabled = indexedCount > 0,
        ) {
            Text("Search local index")
        }

        if (searchResults.isNotEmpty()) {
            Text(
                "${searchResults.size} saved result${if (searchResults.size == 1) "" else "s"}",
                fontWeight = FontWeight.Bold,
            )
            searchResults.forEach { IndexedImageCard(it) }
        } else if (indexedCount > 0 && searchQuery.isNotBlank()) {
            Text("No saved analysis contains that text.")
        }
    }
}

@Composable
private fun IndexedImageCard(image: IndexedImage) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                image.imageUri.substringAfterLast('/'),
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            AnalysisDetails(image.toAnalysisResult())
        }
    }
}

@Composable
private fun AnalysisCard(result: ImageAnalysisResult) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Analysis result", fontWeight = FontWeight.Bold)
            AnalysisDetails(result)
        }
    }
}

@Composable
private fun AnalysisDetails(result: ImageAnalysisResult) {
    LabeledValue("Type", result.contentKind)
    LabeledValue("Receipt confidence", "${(result.receiptConfidence * 100).toInt()}%")
    result.receipt.merchantCandidate?.let { LabeledValue("Merchant", it) }
    result.receipt.transactionDateText?.let { LabeledValue("Date", it) }
    result.receipt.totalText?.let { total ->
        LabeledValue("Total", listOfNotNull(result.receipt.currency, total).joinToString(" · "))
    }
    Spacer(Modifier.height(4.dp))
    Text("Visible text", fontWeight = FontWeight.Bold)
    Text(
        result.ocrText.ifBlank { "No visible text was detected." },
        maxLines = 8,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun LabeledValue(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text("$label: ", fontWeight = FontWeight.SemiBold)
        Text(value)
    }
}
