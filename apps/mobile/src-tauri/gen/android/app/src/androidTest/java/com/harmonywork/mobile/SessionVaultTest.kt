package com.harmonywork.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SessionVaultTest {
  @Test
  fun savesRestoresAndClearsEncryptedSession() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    SessionVault.clear(context)
    SessionVault.save(context, "{\"account\":\"test\",\"apiKey\":\"secret\"}")
    assertEquals("{\"account\":\"test\",\"apiKey\":\"secret\"}", SessionVault.load(context))
    val stored = context.getSharedPreferences("harmony_work_session", 0)
      .getString("encrypted_session", "") ?: ""
    assertTrue(!stored.contains("secret"))
    SessionVault.clear(context)
    assertNull(SessionVault.load(context))
  }
}
