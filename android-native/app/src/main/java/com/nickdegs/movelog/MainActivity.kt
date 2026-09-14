package com.nickdegs.movelog

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.data.ayiklaDavetUri
import com.nickdegs.movelog.ui.MoveLogApp
import com.nickdegs.movelog.ui.theme.MoveLogTheme

// Bildirime dokununca gelen "route" -> MoveLogApp okuyup ilgili sekmeye gider (deep-link).
// Davet: https://app.nickdegs.com/?invite=  ve  movelog://invite?code=
object AppNav {
    var route by mutableStateOf<String?>(null)
    var davetKod by mutableStateOf<String?>(null)
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        intent?.getStringExtra("route")?.let { AppNav.route = it }
        // Android 13+ bildirim izni (FCM push görünsün)
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 7)
        }
        setContent {
            MoveLogTheme {
                val store: Store = viewModel()
                MoveLogApp(store)
            }
        }
        isleDavetIntent(intent)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra("route")?.let { AppNav.route = it }
        isleDavetIntent(intent)
    }
    private fun isleDavetIntent(intent: Intent?) {
        val kod = ayiklaDavetUri(intent?.data)
        if (kod.isNotEmpty()) AppNav.davetKod = kod
    }
}
