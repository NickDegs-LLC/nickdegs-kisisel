package com.nickdegs.movelog

import android.app.Activity
import android.app.Application
import android.os.Bundle

// Kuyruk boşaltmanın UYGULAMA SEVİYESİ tetikleri (20.09 vakası düzeltmesinin parçası).
//
// AÇIK: kuyruk YALNIZ takip servisi yaşarken boşaltılıyordu. Kullanıcı kaydı durdurup kapsama
// dışındaysa (tünel, otobüs, uçak modu) noktalar GÜNLERCE diskte bekleyebiliyordu — veri
// güvendeydi ama kullanıcıya ulaşmıyordu.
//
// ÇÖZÜM: uygulama açılışında ve her öne gelişte de boşaltmayı dene. bosalt() idempotent ve ucuz:
// gönderim zaten sürüyorsa / token yoksa / kimlik yoksa anında döner, ağa boşuna çıkmaz.
// Yeni bağımlılık YOK: ProcessLifecycleOwner (lifecycle-process) projede yok, onun yerine
// çerçevenin kendi ActivityLifecycleCallbacks'i kullanılıyor.
class MoveLogApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // 1) AÇILIŞ: önceki oturumdan kalan noktalar varsa hemen akmaya başlasın.
        KonumKuyrugu.bosalt(this)
        // 2) ÖNE GELME: kullanıcı uygulamayı her açtığında yeniden dene (tipik olarak kapsama
        //    geri dönmüş olur). onActivityResumed = iOS'taki willEnterForeground karşılığı.
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) { KonumKuyrugu.bosalt(activity) }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) { }
            override fun onActivityStarted(activity: Activity) { }
            override fun onActivityPaused(activity: Activity) { }
            override fun onActivityStopped(activity: Activity) { }
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) { }
            override fun onActivityDestroyed(activity: Activity) { }
        })
    }
}
