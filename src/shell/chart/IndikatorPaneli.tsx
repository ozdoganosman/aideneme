import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, IconButton, NumberField, Toggle } from '../../ui';
import { Icon } from '../../ui/icons';
import {
  INDIKATORLER,
  INDIKATOR_ILE,
  indikatorAra,
  parametreSinirla,
  varsayilanParametreler,
  type IndikatorTanimi,
  type Parametreler,
} from '../../core/indicators/kayit';

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
function ozet(t: IndikatorTanimi, p: Parametreler): string {
  return t.parametreler.map((s) => p[s.ad]).join(' · ');
}

interface Props {
  ornekler: IndikatorOrnegi[];
  onDegis: (ornekler: IndikatorOrnegi[]) => void;
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
export function IndikatorPaneli({ ornekler, onDegis }: Props) {
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

  const duzenlenen = ornekler.find((o) => o.ornekId === ayarOrnek) ?? null;
  const duzenlenenTanim = duzenlenen ? (INDIKATOR_ILE.get(duzenlenen.id) ?? null) : null;

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
            const t = INDIKATOR_ILE.get(o.id);
            // Tanımı bilinmeyen örnek SESSİZCE düşmüyor: kullanıcı neyi
            // kaybettiğini görsün ve silebilsin.
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
            return (
              <li key={o.ornekId} className="ind__satir">
                <Toggle
                  label={ad}
                  checked={o.gorunur}
                  onChange={(v) => guncelle(o.ornekId, { gorunur: v })}
                />
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
        open={!!duzenlenen && !!duzenlenenTanim}
        onClose={() => setAyarOrnek(null)}
        title={duzenlenenTanim ? `${duzenlenenTanim.ad} ayarları` : 'Ayarlar'}
        size="sm"
        footer={
          duzenlenen && duzenlenenTanim ? (
            <>
              <Button
                variant="ghost"
                onClick={() =>
                  guncelle(duzenlenen.ornekId, {
                    parametreler: varsayilanParametreler(duzenlenenTanim),
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
        {duzenlenen && duzenlenenTanim
          ? duzenlenenTanim.parametreler.map((s) => (
              <NumberField
                key={s.ad}
                label={s.etiket}
                value={duzenlenen.parametreler[s.ad]}
                min={s.min}
                max={s.max}
                step={s.ondalik ? 0.1 : 1}
                hint={`${s.min}–${s.max}`}
                onChange={(v) =>
                  guncelle(duzenlenen.ornekId, {
                    // Sınır tek yerde: aynı kural worker'da da uygulanıyor.
                    parametreler: parametreSinirla(duzenlenenTanim, {
                      ...duzenlenen.parametreler,
                      [s.ad]: v,
                    }),
                  })
                }
              />
            ))
          : null}
      </Dialog>
    </div>
  );
}
