import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAutoId, useClickOutside, useEscape, useFocusTrap } from './hooks';

export interface PopoverProps {
  /** Tetikleyici: render-prop, böylece herhangi bir düğme/kart olabilir. */
  trigger: (props: {
    'aria-expanded': boolean;
    'aria-haspopup': 'dialog';
    'aria-controls': string;
    onClick: () => void;
  }) => ReactNode;
  title?: string;
  /** Tercih edilen yön; ekrana sığmazsa öteki yön seçilir. */
  align?: 'start' | 'end';
  /**
   * İçerik. Fonksiyon verilirse `kapat` geçilir: seçim yapıldığında paneli
   * kapatması gereken menü tarzı içerikler için (hazır filtreler gibi).
   */
  children: ReactNode | ((kapat: () => void) => ReactNode);
}

/** Panelin ekran kenarına bırakacağı boşluk. */
const KENAR = 8;

/**
 * Bağlamsal katman. Ürün ilkesi #2'nin ("her sayı tıklanabilir") taşıyıcısı:
 * bir metriğin formülü/kaynağı bunun içinde açılır.
 *
 * PANEL GÖVDEYE TAŞINIYOR (portal) ve `position: fixed` ile konumlanıyor.
 *
 * Neden: panel tetikleyicinin yanında, `position: absolute` ile duruyordu ve
 * KAYDIRILABİLİR bir atanın içinde kaldığında o ata onu KIRPIYORDU. Gerçek
 * veride ölçüldü — radar panelinin sarmalayıcısı (`overflow: auto`) "Hazır
 * filtreler" listesinin sol yarısını kesiyordu, açıklamalar okunamıyordu.
 * Sağa açıldığında ise 1.500 px'lik pencerede 1.585 px'e uzanıp ekranın
 * dışına taşıyordu.
 *
 * Portal ikisini birden çözüyor: hiçbir ata kırpamıyor ve konum ekrana göre
 * hesaplandığı için sınırın dışına çıkmıyor. Yön TERCİH: sığmıyorsa öteki
 * yöne dönüyor, o da sığmıyorsa kenara yapıştırılıyor.
 */
export function Popover({ trigger, title, align = 'start', children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [konum, setKonum] = useState<{ top: number; left: number; enYuksek?: number } | null>(null);
  const id = useAutoId('popover');

  // Tıklama dışarıda mı: panel artık kökün İÇİNDE değil, ayrıca sorulması
  // gerekiyor — yoksa panelin kendisine tıklamak onu kapatırdı.
  const disarida = useCallback((hedef: Node) => !panelRef.current?.contains(hedef), []);
  const kapat = useCallback(() => setOpen(false), []);
  useClickOutside(rootRef, kapat, open, disarida);
  useEscape(open, kapat);
  /*
    ODAK TUZAĞI — portalın bedeli.

    Panel gövdeye taşınınca DOM SIRASI tetikleyiciden koptu: Tab ile
    tetikleyiciden panele geçilemiyor, panel belgenin en sonunda kalıyordu.
    Klavye denetimi bunu yakaladı (tek durak bulundu, beklenen >5).

    Panel zaten `role="dialog"`: açılışta odak içeri giriyor, Tab panelin
    içinde dönüyor, Esc kapatıp odağı TETİKLEYİCİYE geri veriyor. Yani
    portalın getirdiği kopukluk odakla kapatılıyor.
  */
  useFocusTrap(panelRef, open);

  const yerlestir = useCallback(() => {
    const tetik = rootRef.current;
    const panel = panelRef.current;
    if (!tetik || !panel) return;
    const t = tetik.getBoundingClientRect();
    const g = panel.offsetWidth;
    /*
      DOĞAL yükseklik ölçülüyor: sınır geçici olarak kaldırılıp okunuyor.

      Sınırlı hâli ölçseydik salınım olurdu — sınır uygulanınca panel kısalır,
      kısalan panel "alta sığıyor" görünür, sınır kalkar, panel uzar, yine
      sığmaz… Karşılaştırma her zaman sınırsız yükseklikle yapılmalı.
    */
    const oncekiSinir = panel.style.maxHeight;
    panel.style.maxHeight = '';
    const y = panel.offsetHeight;
    panel.style.maxHeight = oncekiSinir;

    // Tercih edilen yön sığmıyorsa öteki yön; o da sığmıyorsa kenara yaslanır.
    let left = align === 'end' ? t.right - g : t.left;
    if (left + g > innerWidth - KENAR) left = t.right - g;
    if (left < KENAR) left = t.left;
    left = Math.min(Math.max(left, KENAR), Math.max(KENAR, innerWidth - g - KENAR));

    /*
      DİKEY: önce sığan taraf, sonra KENETLEME, gerekirse YÜKSEKLİK SINIRI.

      Burada yalnızca "altta yer yoksa ve üstte TAM sığıyorsa yukarı dön"
      vardı. İkisine de sığmayan panel aşağıda kalıp ekranın dışına
      sarkıyordu — yatay eksende kenetleme vardı, dikeyde yoktu. Gerçek
      veride ölçüldü: 27 sektör rozetiyle radar filtre paneli 390×780
      telefonda 988 px'e uzanıyordu, yani 208 px'i ekranın altında.

      Sığmıyorsa panel artık GENİŞ olan tarafa yerleşiyor ve yüksekliği o
      tarafa sığacak kadar sınırlanıyor; içeriği kendi içinde kayıyor.
      Kırpılmış bir panelden, kaydırılabilir bir panel iyidir.
    */
    // Boşluklar GÖRÜNÜR alana kenetleniyor. Kenetlenmeyince tetikleyici
    // ekranın dışındayken olmayan bir boşluk hesaplanıyordu: gerçek veride
    // 390×780 telefonda tetikleyici 826 px'te, yani ekranın altındaydı;
    // "üstte 812 px yer var" denip panel o boyda açılıyor ve 820 px'e
    // uzanıyordu. Yatay eksende bu kenetleme zaten vardı.
    const tUst = Math.min(Math.max(t.top, 0), innerHeight);
    const tAlt = Math.min(Math.max(t.bottom, 0), innerHeight);
    const altBosluk = innerHeight - tAlt - 6 - KENAR;
    const ustBosluk = tUst - 6 - KENAR;

    let top: number;
    let enYuksek: number | undefined;
    if (y <= altBosluk) {
      top = tAlt + 6;
    } else if (y <= ustBosluk) {
      top = tUst - y - 6;
    } else if (altBosluk >= ustBosluk) {
      top = tAlt + 6;
      enYuksek = Math.max(120, altBosluk);
    } else {
      enYuksek = Math.max(120, ustBosluk);
      top = tUst - enYuksek - 6;
    }

    // SON KENETLEME — yatay eksendekinin aynısı. 120 px'lik taban, iki
    // boşluk da ondan küçükken sınırı aşabiliyor; o durumda bile panel
    // ekranda kalmalı, kaydırılarak okunmalı.
    const etkinYukseklik = Math.min(y, enYuksek ?? y);
    top = Math.min(Math.max(top, KENAR), Math.max(KENAR, innerHeight - etkinYukseklik - KENAR));

    setKonum({ top, left, enYuksek });
  }, [align]);

  // Ölçüm BOYAMADAN ÖNCE: `useEffect` ile panel bir kare boyunca (0,0)
  // konumunda görünüp yerine sıçrıyordu.
  useLayoutEffect(() => {
    if (open) yerlestir();
    else setKonum(null);
  }, [open, yerlestir]);

  /*
    İÇERİK SONRADAN BÜYÜYEBİLİR. Radar filtre panelinin sektör rozetleri
    sınıflandırma dosyası inince geliyor; açılışta ölçülen yükseklik o an
    doğru, bir saniye sonra yanlış. Gerçek veride ölçüldü — 360×640 ekranda
    panel yerleştirildikten sonra 1.698 px'e büyüyüp ekranın dışına taştı.

    Boyut değişimi yeniden yerleştiriyor. Salınım riski yok: ölçüm her zaman
    DOĞAL yüksekliği okuyor (bkz. yukarısı).
  */
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => yerlestir());
    ro.observe(panel);
    return () => ro.disconnect();
  }, [open, yerlestir]);

  useEffect(() => {
    if (!open) return;
    const guncelle = () => yerlestir();
    // `capture`: panel kaydırılabilir bir atanın içindeki bir düğmeye bağlı
    // olabilir ve o ata kaydırıldığında da yer değiştirmeli.
    addEventListener('scroll', guncelle, true);
    addEventListener('resize', guncelle);
    return () => {
      removeEventListener('scroll', guncelle, true);
      removeEventListener('resize', guncelle);
    };
  }, [open, yerlestir]);

  return (
    <div className="ui-popover" ref={rootRef}>
      {trigger({
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': id,
        onClick: () => setOpen((v) => !v),
      })}
      {open
        ? createPortal(
            <div
              id={id}
              ref={panelRef}
              role="dialog"
              aria-label={title}
              // İçinde odaklanabilir öğe olmayan panel (yalnızca metin taşıyan
              // provenance katmanı) da odağı alabilmeli.
              tabIndex={-1}
              className="ui-popover__panel"
              // Konum hesaplanana kadar GÖRÜNMEZ: ölçüm için yerleştirilmesi
              // gerekiyor ama yanlış yerde bir kare bile görünmemeli.
              style={{
                top: konum?.top ?? 0,
                left: konum?.left ?? 0,
                maxHeight: konum?.enYuksek,
                visibility: konum ? 'visible' : 'hidden',
              }}
            >
              {title ? <h3 className="ui-popover__title">{title}</h3> : null}
              {typeof children === 'function' ? children(kapat) : children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
