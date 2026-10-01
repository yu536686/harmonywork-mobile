package com.harmonywork.mobile

import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class BarcodeModelTest {
  @Test
  fun bundledModelReadsDesktopPairingQrWithoutPlayServicesDownload() {
    val context = InstrumentationRegistry.getInstrumentation().context
    val bitmap = context.assets.open("pairing-qr.png").use { BitmapFactory.decodeStream(it) }
    val scanner = BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    )
    try {
      val codes = Tasks.await(scanner.process(InputImage.fromBitmap(bitmap, 0)), 15, TimeUnit.SECONDS)
      assertEquals(
        "harmonywork://pair?id=3ecc3126-67a5-4e33-bfad-f1fe2308ef9e&secret=${"A".repeat(43)}",
        codes.single().rawValue,
      )
    } finally {
      scanner.close()
    }
  }
}
