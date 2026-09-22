import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, IconButton, NumberField, Toggle } from '../../ui';
import { Icon } from '../../ui/icons';
import {
  INDIKATORLER,
  INDIKATOR_ILE,
  indikatorAra,
  varsayilanParametreler,
  type IndikatorTanimi,
  type Parametreler,
  type SayiParametresi,
} from '../../core/indicators/kayit';
import type { Candles } from '../../core/data/types';
/*
  Düzenleyici TEMBEL: kod yazmak isteyen kullanıcı azınlık, ama kip her
  sembol masası yüklemesinde paketin içinde taşınıyordu. Ölçüldü: masa yığını
  indikatör sistemiyle 11,2 kB'den 30,1 kB'ye çıkmıştı; hesapları ayırmak
  26,0'a indirdi, düzenleyiciyi ayırmak kalanı alıyor.
*/
const GostergeDuzenleyici = lazy(() =>
  import('./GostergeDuzenleyici').then((m) => ({ default: m.GostergeDuzenleyici })),
);
import { kullaniciGostergeleriYaz, type KullaniciGostergesi } from './kullaniciGosterge';

/**
 * Ayar kutusunun ihtiyaç duyduğu ASGARİ şema.
 *
 * Barındırılan gösterge ile kullanıcınınki aynı kutuyu kullanıyor; kutunun
 * hesap fonksiyonuna ihtiyacı yok, yalnızca parametre listesine. Ortak tip
 * bu yüzden tanımın tamamı değil.
 */
interface SemaGibi {
  ad: string;
  kisa: string;
  parametreler: SayiParametresi[];
}

function semaVarsayilan(s: SemaGibi): Parametreler {
  const out: Parametreler = {};
  for (const p of s.parametreler) out[p.ad] = p.varsayilan;
  return out;
}

/** `parametreSinirla` ile aynı kural; tanım yerine şemayla çalışıyor. */
function semaSinirla(s: SemaGibi, p: Parametreler): Parametreler {
  const out: Parametreler = {};
  for (const alan of s.parametreler) {
    const ham = p[alan.ad];
    const v = Number.isFinite(ham) ? ham : alan.varsayilan;
    const sinirli = Math.min(alan.max, Math.max(alan.min, v));
    out[alan.ad] = alan.ondalik ? sinirli : Math.round(sinirli);
  }
  return out;
}

/**
 * Grafiğe EKLENMİŞ bir gösterge.
 *
 * Aynı gösterge birden çok kez eklenebilsin diye `ornekId` var: "EMA 50" ve
 * "EMA 200" aynı tanımın iki örneği. Sabit sistemde bu mümkün değildi —
 * ikinci bir EMA istemek kod değişikliği demekti.
 */
export interface IndikatorOrnegi {
  ornekId: string;
  id: string;
  parametreler: Parametreler;
  gorunur: boolean;
}

/** Örnek kimliği: çakışmaması yeter, anlam taşımıyor. */
export function yeniOrnekId(): string {
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function ornekOlustur(id: string): IndikatorOrnegi | null {
  const t = INDIKATOR_ILE.get(id);
  if (!t) return null;
  return { ornekId: yeniOrnekId(), id, parametreler: varsayilanParametreler(t), gorunur: true };
}

/** Ayarların tek satırlık özeti: "20 · 2" gibi. */
function ozet(t: SemaGibi, p: Parametreler): string {
  return t.parametreler.map((s) => p[s.ad]).join(' · ');
}

interface Props {
  ornekler: IndikatorOrnegi[];
  onDegis: (ornekler: IndikatorOrnegi[]) => void;
  /** Kullanıcının kendi yazdığı göstergeler. */
  kullanici: KullaniciGostergesi[];
  onKullaniciDegis: (liste: KullaniciGostergesi[]) => void;
  /** Denemenin koşacağı seri — açık sembolün mumları. */
  mumlar: Candles | null;
  /** Örnek kimliği → kullanıcı göstergesinin hata mesajı. */
  hatalar?: Record<string, string>;
}

/**
 * İNDİKATÖR YÖNETİMİ.
 *
 * Kullanıcı isteği: "indikatör sistemini trading view gibi yapabilir miyiz,
 * arama butonu orada indikatörler; indikatörün ayar kısmında parametrelerin
 * değiştirilebilmesi".
 *
 * Ayar kutusu ELLE YAZILMIYOR, tanımın parametre şemasından üretiliyor. Elle
 * yazılsaydı yeni bir gösterge eklemek yine iki yeri (hesap + arayüz) güncel
 * tutmayı gerektirirdi ve bu oturumda tam olarak bu sınıf kusur beş kez çıktı.
 */
export function IndikatorPaneli({
  ornekler,
  onDegis,
  kullanici,
  onKullaniciDegis,
  mumlar,
  hatalar = {},
}: Props) {
  const [duzenleyiciAcik, setDuzenleyiciAcik] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<KullaniciGostergesi | null>(null);
  const [aramaAcik, setAramaAcik] = useState(false);
  const [ayarOrnek, setAyarOrnek] = useState<string | null>(null);
  const [sorgu, setSorgu] = useState('');
  const aramaRef = useRef<HTMLInputElement>(null);

  /*
    Arama kutusuna odak: kullanıcı kutuyu açar açmaz yazabilmeli. `autoFocus`
    özniteliği DEĞİL — o, kipsiz sayfalarda odağı kaçırıp erişilebilirliği
    bozduğu için yasak (jsx-a11y/no-autofocus). Burada odak KİP AÇILDIĞINDA
    ve kipin içinde kalıyor (Dialog odağı zaten hapsediyor).
  */
  useEffect(() => {
    if (aramaAcik) aramaRef.current?.focus();
  }, [aramaAcik]);

  const bulunan = useMemo(() => indikatorAra(sorgu), [sorgu]);
  const kategoriler = useMemo(() => {
    const gruplar = new Map<string, IndikatorTanimi[]>();
    for (const t of bulunan) {
      const liste = gruplar.get(t.kategori) ?? [];
      liste.push(t);
      gruplar.set(t.kategori, liste);
    }
    return [...gruplar];
  }, [bulunan]);

  /**
   * Bir örneğin ŞEMASI — barındırılan gösterge ya da kullanıcınınki.
   *
   * Arayüz ikisini ayırmıyor: aynı çip, aynı ayar kutusu. Fark yalnızca
   * hesabın nerede koştuğu ve o karar kimlik önekine bakılarak veriliyor.
   */
  const semaBul = (id: string): SemaGibi | null => {
    const t = INDIKATOR_ILE.get(id);
    if (t) return { ad: t.ad, kisa: t.kisa, parametreler: t.parametreler };
    const k = kullanici.find((g) => g.id === id);
    return k ? { ad: k.ad, kisa: k.kisa, parametreler: k.parametreler } : null;
  };

  const ayarlanan = ornekler.find((o) => o.ornekId === ayarOrnek) ?? null;
  const ayarlananSema = ayarlanan ? semaBul(ayarlanan.id) : null;

  const guncelle = (ornekId: string, yama: Partial<IndikatorOrnegi>) => {
    onDegis(ornekler.map((o) => (o.ornekId === ornekId ? { ...o, ...yama } : o)));
  };

  return (
    <div className="ind">
      <div className="ind__bar">
        <Button size="sm" variant="secondary" onClick={() => setAramaAcik(true)}>
          <Icon name="search" size={14} /> İndikatörler
        </Button>
        {ornekler.length === 0 ? (
          <span className="desk__muted">Henüz gösterge eklenmedi.</span>
        ) : null}
      </div>

      {ornekler.length > 0 ? (
        <ul className="ind__liste" aria-label="Eklenen göstergeler">
          {ornekler.map((o) => {
            const t = semaBul(o.id);
            // Tanımı bilinmeyen örnek SESSİZCE düşmüyor: kullanıcı neyi
            // kaybettiğini görsün ve silebilsin. (Silinen bir kullanıcı
            // göstergesinin örneği de buraya düşüyor.)
            if (!t) {
              return (
                <li key={o.ornekId} className="ind__satir ind__satir--bilinmeyen">
                  <span>Bilinmeyen gösterge ({o.id})</span>
                  <IconButton
                    label={`${o.id} göstergesini kaldır`}
                    onClick={() => onDegis(ornekler.filter((x) => x.ornekId !== o.ornekId))}
                  >
                    <Icon name="close" size={12} />
                  </IconButton>
                </li>
              );
            }
            /*
              Erişilebilir ad PARAMETREYİ de söylüyor.

              İlk yazımda "Üstel Hareketli Ortalama ayarları" idi ve EMA 50 ile
              EMA 200 için AYNI addı — ekran okuyucu kullanıcısı hangisini
              açtığını bilemezdi. Kendi erişilebilirlik denetimim yakaladı
              ("aynı ada sahip düğmeler ayırt edilemez ×2"). Aynı göstergeyi
              birden çok kez eklemek bu sistemin amacı olduğu için ad da
              örneğe özel olmalı.
            */
            const ad = `${t.kisa} ${ozet(t, o.parametreler)}`;
            const hata = hatalar[o.ornekId];
            return (
              <li
                key={o.ornekId}
                className={`ind__satir ${hata ? 'ind__satir--hatali' : ''}`}
                /* Hata SESSİZ kalmamalı: çizilmeyen bir gösterge ile
                   "değeri yok" ayırt edilemezdi. */
                title={hata}
              >
                <Toggle
                  label={ad}
                  checked={o.gorunur}
                  onChange={(v) => guncelle(o.ornekId, { gorunur: v })}
                />
                {hata ? (
                  <span className="ind__hata" role="status">
                    hata
                  </span>
                ) : null}
                <span className="ind__eylem">
                  <IconButton label={`${ad} ayarları`} onClick={() => setAyarOrnek(o.ornekId)}>
                    <Icon name="swatch" size={12} />
                  </IconButton>
                  <IconButton
                    label={`${ad} göstergesini kaldır`}
                    onClick={() => onDegis(ornekler.filter((x) => x.ornekId !== o.ornekId))}
                  >
                    <Icon name="close" size={12} />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog
        open={aramaAcik}
        onClose={() => setAramaAcik(false)}
        title="İndikatör ekle"
        description="Ada, kısaltmaya ya da kategoriye göre arayın."
        size="md"
      >
        {/* Kitin alan yapısı: sarmalayan <label> değil, ayrı etiket + girdi. */}
        <div className="ui-field ind__ara">
          <label className="ui-field__label" htmlFor="ind-ara">
            Ara
          </label>
          <input
            id="ind-ara"
            className="ui-input"
            type="search"
            ref={aramaRef}
            value={sorgu}
            placeholder="RSI, bollinger, oynaklık…"
            onChange={(e) => setSorgu(e.target.value)}
          />
        </div>
        {/*
          KENDİ GÖSTERGELERİN en üstte: arayanın kendi yazdığı şey, otuz
          barındırılan göstergenin altında kaybolmamalı.
        */}
        <section className="ind__kategori">
          <h3>Kendi göstergelerim</h3>
          <ul>
            {kullanici
              .filter((g) => aramaEslesiyor(g, sorgu))
              .map((g) => (
                <li key={g.id} className="ind__kullanici">
                  <button
                    type="button"
                    className="ind__ekle"
                    onClick={() => {
                      onDegis([
                        ...ornekler,
                        {
                          ornekId: yeniOrnekId(),
                          id: g.id,
                          parametreler: semaVarsayilan(g),
                          gorunur: true,
                        },
                      ]);
                      setAramaAcik(false);
                      setSorgu('');
                    }}
                  >
                    <b>{g.kisa}</b>
                    <span>{g.ad}</span>
                    <span className="desk__muted">
                      {g.panel === 'fiyat' ? 'fiyat üstünde' : 'ayrı panel'}
                    </span>
                  </button>
                  <span className="ind__eylem">
                    <IconButton
                      label={`${g.ad} kodunu düzenle`}
                      onClick={() => {
                        setDuzenlenen(g);
                        setDuzenleyiciAcik(true);
                        setAramaAcik(false);
                      }}
                    >
                      <Icon name="swatch" size={12} />
                    </IconButton>
                    <IconButton
                      label={`${g.ad} göstergesini sil`}
                      onClick={() => {
                        const kalan = kullanici.filter((x) => x.id !== g.id);
                        kullaniciGostergeleriYaz(kalan);
                        onKullaniciDegis(kalan);
                      }}
                    >
                      <Icon name="close" size={12} />
                    </IconButton>
                  </span>
                </li>
              ))}
            <li>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDuzenlenen(null);
                  setDuzenleyiciAcik(true);
                  setAramaAcik(false);
                }}
              >
                <Icon name="plus" size={14} /> Yeni gösterge yaz
              </Button>
            </li>
          </ul>
        </section>

        {kategoriler.length === 0 ? (
          <p className="desk__muted">
            "{sorgu}" ile eşleşen gösterge yok. {INDIKATORLER.length} gösterge barındırılıyor.
          </p>
        ) : (
          kategoriler.map(([kategori, liste]) => (
            <section key={kategori} className="ind__kategori">
              <h3>{kategori}</h3>
              <ul>
                {liste.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="ind__ekle"
                      onClick={() => {
                        const yeni = ornekOlustur(t.id);
                        if (yeni) onDegis([...ornekler, yeni]);
                        setAramaAcik(false);
                        setSorgu('');
                      }}
                    >
                      <b>{t.kisa}</b>
                      <span>{t.ad}</span>
                      <span className="desk__muted">
                        {t.panel === 'fiyat' ? 'fiyat üstünde' : 'ayrı panel'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </Dialog>

      <Dialog
        open={!!ayarlanan && !!ayarlananSema}
        onClose={() => setAyarOrnek(null)}
        title={ayarlananSema ? `${ayarlananSema.ad} ayarları` : 'Ayarlar'}
        size="sm"
        footer={
          ayarlanan && ayarlananSema ? (
            <>
              <Button
                variant="ghost"
                onClick={() =>
                  guncelle(ayarlanan.ornekId, {
                    parametreler: semaVarsayilan(ayarlananSema),
                  })
                }
              >
                Varsayılana dön
              </Button>
              <Button onClick={() => setAyarOrnek(null)}>Kapat</Button>
            </>
          ) : null
        }
      >
        {ayarlanan && ayarlananSema
          ? ayarlananSema.parametreler.map((s) => (
              <NumberField
                key={s.ad}
                label={s.etiket}
                value={ayarlanan.parametreler[s.ad]}
                min={s.min}
                max={s.max}
                step={s.ondalik ? 0.1 : 1}
                hint={`${s.min}–${s.max}`}
                onChange={(v) =>
                  guncelle(ayarlanan.ornekId, {
                    // Sınır tek yerde: aynı kural worker'da da uygulanıyor.
                    parametreler: semaSinirla(ayarlananSema, {
                      ...ayarlanan.parametreler,
                      [s.ad]: v,
                    }),
                  })
                }
              />
            ))
          : null}
      </Dialog>

      {/* Kip kapalıyken hiç indirilmiyor; açılışta kısa bir bekleme kabul. */}
      <Suspense fallback={null}>
        {duzenleyiciAcik ? (
          <GostergeDuzenleyici
            acik={duzenleyiciAcik}
            duzenlenen={duzenlenen}
            mumlar={mumlar}
            onKapat={() => setDuzenleyiciAcik(false)}
            onKaydet={(g) => {
              const kalan = kullanici.filter((x) => x.id !== g.id);
              const liste = [...kalan, g];
              kullaniciGostergeleriYaz(liste);
              onKullaniciDegis(liste);
              setDuzenleyiciAcik(false);
            }}
          />
        ) : null}
      </Suspense>
    </div>
  );
}

/** Kullanıcı göstergesi aramada eşleşiyor mu (ada ve kısa ada bakar). */
function aramaEslesiyor(g: KullaniciGostergesi, sorgu: string): boolean {
  const q = sorgu.trim().toLowerCase();
  if (!q) return true;
  return `${g.ad} ${g.kisa}`.toLowerCase().includes(q);
}
