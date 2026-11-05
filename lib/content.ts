import type { Locale } from "@/i18n/routing";
import type { BranchId } from "@/lib/branches";

export interface Service {
  title: string;
  blurb: string;
  /** WhatsApp topic; when absent the card links to `href` instead */
  topic?: string;
  /** an in-page anchor ("#catalog") or a site page ("/packages") */
  href?: string;
  linkLabel: string;
  photoAlt: string;
  /** 1600×900 (PPF 1600×700), subject centred — the cards crop the edges */
  image: string;
}

// Our own photos in public/assets/services; maintenance is still a stock
// placeholder (Unsplash) until its photo arrives
const SERVICE_IMAGES = {
  bodyKit: "/assets/services/accessories.webp",
  protection: "/assets/services/ppf.webp",
  programming: "/assets/services/programming.webp",
  parts: "/assets/services/parts.webp",
  maintenance: "https://images.unsplash.com/photo-1487754180451-c456f719a1fc?auto=format&fit=crop&w=1200&q=70",
};

const SERVICES: Record<Locale, Service[]> = {
  ar: [
    {
      title: "إكسسوارات وبودي كيت",
      blurb: "شبك أمامي، صدامات، جناح خلفي، وشعارات الإصدار الأسود.",
      topic: "الإكسسوارات والبودي كيت",
      linkLabel: "استفسر عبر واتساب",
      photoAlt: "سيارة جيتور وأمامها إكسسوارات وقطع بودي كيت في ورشة وولف كار",
      image: SERVICE_IMAGES.bodyKit,
    },
    {
      title: "حماية PPF وعازل وتظليل",
      blurb: "فيلم حماية XPEL لجميع أنواع السيارات، مع عازل حراري وتظليل للزجاج.",
      href: "/packages",
      linkLabel: "شاهد الباقات والأسعار",
      photoAlt: "فريق وولف كار يركّب فيلم حماية على سيارة بيضاء",
      image: SERVICE_IMAGES.protection,
    },
    {
      title: "برمجة وتشخيص",
      blurb: "برمجة وتحديثات، باشتراك سنوي أو لمرة واحدة.",
      topic: "البرمجة والتشخيص",
      linkLabel: "استفسر عبر واتساب",
      photoAlt: "جهاز تشخيص وبرمجة موصول بالسيارة",
      image: SERVICE_IMAGES.programming,
    },
    {
      title: "قطع غيار",
      blurb: "قطع للسيارات الصينية وغير الصينية.",
      href: "#catalog",
      linkLabel: "تصفح الفئات",
      photoAlt: "قطع غيار أمامية لسيارة في ورشة وولف كار",
      image: SERVICE_IMAGES.parts,
    },
    {
      title: "زيوت وصيانة",
      blurb: "تغيير الزيت والفلاتر والصيانة الدورية.",
      topic: "الزيوت والصيانة",
      linkLabel: "استفسر عبر واتساب",
      photoAlt: "صورة صيانة",
      image: SERVICE_IMAGES.maintenance,
    },
  ],
  en: [
    {
      title: "Accessories & Body Kits",
      blurb: "Front grilles, bumpers, rear spoilers, and Black Edition badges.",
      topic: "Accessories & body kits",
      linkLabel: "Ask on WhatsApp",
      photoAlt: "A Jetour with accessories and body kit parts laid out in the Wolf Car workshop",
      image: SERVICE_IMAGES.bodyKit,
    },
    {
      title: "PPF, Insulation & Tinting",
      blurb: "XPEL protective film for all car types, plus heat insulation and window tinting.",
      href: "/packages",
      linkLabel: "See packages & prices",
      photoAlt: "The Wolf Car team applying protective film to a white car",
      image: SERVICE_IMAGES.protection,
    },
    {
      title: "Programming & Diagnostics",
      blurb: "Programming and updates, yearly subscription or one-time.",
      topic: "Programming & diagnostics",
      linkLabel: "Ask on WhatsApp",
      photoAlt: "A diagnostic and programming tablet connected to a car",
      image: SERVICE_IMAGES.programming,
    },
    {
      title: "Spare Parts",
      blurb: "Parts for Chinese and non-Chinese cars.",
      href: "#catalog",
      linkLabel: "Browse categories",
      photoAlt: "Front-end spare parts for a car in the Wolf Car workshop",
      image: SERVICE_IMAGES.parts,
    },
    {
      title: "Oils & Maintenance",
      blurb: "Oil changes, filters, and routine maintenance.",
      topic: "Oils & maintenance",
      linkLabel: "Ask on WhatsApp",
      photoAlt: "Maintenance photo",
      image: SERVICE_IMAGES.maintenance,
    },
  ],
};

export interface WorkVideo {
  platform: "tiktok" | "instagram";
  /** TikTok: the number at the end of the video link. Instagram: the code after /reel/ */
  id: string;
  /** saved copy of the video's cover in public/assets/work (the platforms' own links expire) */
  thumb: string;
  title: string;
}

/** Clips in "Our Work", in display order. Add a video: its id, a cover image, a short title. */
const WORK_VIDEOS: Record<Locale, WorkVideo[]> = {
  ar: [
    { platform: "tiktok", id: "7685463028988497172", thumb: "/assets/work/tt-7685463028988497172.webp", title: "روكس 01 بحماية XPEL كاملة" },
    { platform: "instagram", id: "DbliRNpMWUP", thumb: "/assets/work/ig-DbliRNpMWUP.webp", title: "خبراء برمجة السيارات الصينية" },
    { platform: "tiktok", id: "7679947663978138901", thumb: "/assets/work/tt-7679947663978138901.webp", title: "عبدالله الغافري في وولف كار" },
    { platform: "instagram", id: "DcbHWGTN-Yu", thumb: "/assets/work/ig-DcbHWGTN-Yu.webp", title: "من باب بيتك بالسطحة… والباقي علينا" },
    { platform: "tiktok", id: "7675892113573170452", thumb: "/assets/work/tt-7675892113573170452.webp", title: "إصلاح الطعجات PDR بدون صبغ" },
    { platform: "instagram", id: "Db52PjhNUTI", thumb: "/assets/work/ig-Db52PjhNUTI.webp", title: "كل خدمات سيارتك بمكان واحد" },
  ],
  en: [
    { platform: "tiktok", id: "7685463028988497172", thumb: "/assets/work/tt-7685463028988497172.webp", title: "ROX 01 with full XPEL protection" },
    { platform: "instagram", id: "DbliRNpMWUP", thumb: "/assets/work/ig-DbliRNpMWUP.webp", title: "Chinese car programming experts" },
    { platform: "tiktok", id: "7679947663978138901", thumb: "/assets/work/tt-7679947663978138901.webp", title: "Abdullah Al-Ghafri at Wolf Car" },
    { platform: "instagram", id: "DcbHWGTN-Yu", thumb: "/assets/work/ig-DcbHWGTN-Yu.webp", title: "Picked up from your door by flatbed" },
    { platform: "tiktok", id: "7675892113573170452", thumb: "/assets/work/tt-7675892113573170452.webp", title: "PDR dent repair, no repaint" },
    { platform: "instagram", id: "Db52PjhNUTI", thumb: "/assets/work/ig-Db52PjhNUTI.webp", title: "Every car service in one place" },
  ],
};

export interface GoogleReview {
  name: string;
  /** copied word for word from the Google listing, in the language it was written */
  text: string;
  rating: 1 | 2 | 3 | 4 | 5;
  branch: BranchId;
}

/**
 * Real reviews only, copied from the branches' Google listings — never write,
 * edit or translate one (reviews Google only showed translated are left out).
 * Collected 2026-09-23.
 */
export const GOOGLE_REVIEWS: GoogleReview[] = [
  {
    name: "Nas Ali abu Rayyan",
    text: "Excellent service, friendly and supportive staff, and a wide of accessories for Chinese cars, with best BBF qualities Their car programming service is also professional. 🚗👍appreciated all staff members …",
    rating: 5,
    branch: "binomran",
  },
  { name: "Feras aloraibi", text: "Best place to buy accessories for your Chinese car", rating: 5, branch: "gharrafa" },
  { name: "A A M", text: "Amazing services with amazing Hospitality.", rating: 5, branch: "binomran" },
  { name: "Mohammad Zahid", text: "Good job", rating: 5, branch: "gharrafa" },
];

/** Each branch's Google rating and its listing. Update the numbers from Google now and then. */
export const GOOGLE_RATINGS: { branch: BranchId; rating: string; count: number; url: string }[] = [
  { branch: "binomran", rating: "5.0", count: 9, url: "https://share.google/YZWDu79vQCysrXZsq" },
  { branch: "gharrafa", rating: "4.8", count: 25, url: "https://share.google/aajPmo5exVWZ5yP5Z" },
];

export interface CarBrand {
  name: string;
  logo?: string;
  /** no logo file yet — rendered as a wordmark */
  wordmark?: boolean;
  more?: boolean;
}

const CLOUDINARY = "https://res.cloudinary.com/dzcq09k8h/image/upload/h_120,c_fit,f_auto,q_auto";

const CAR_BRANDS: Record<Locale, CarBrand[]> = {
  ar: [
    { name: "جيتور", logo: `${CLOUDINARY}/v1778141932/gts-removebg-preview_i7p5z0.png` },
    { name: "تانك", logo: `${CLOUDINARY}/v1777809187/Tank_ef7iw6.png` },
    { name: "روكس", logo: "/assets/logo-rox.webp" },
    { name: "هافال", logo: `${CLOUDINARY}/v1777809187/Haval_lkx9rr.png` },
    { name: "ليوبارد", logo: `${CLOUDINARY}/v1777809187/Leopard_nr8cuy.png` },
    { name: "تويوتا", logo: "/assets/logo-toyota.webp" },
    { name: "نيسان", wordmark: true }, // TODO: needs a white/silver transparent PNG
    { name: "+ جميع السيارات", more: true },
  ],
  en: [
    { name: "Jetour", logo: `${CLOUDINARY}/v1778141932/gts-removebg-preview_i7p5z0.png` },
    { name: "Tank", logo: `${CLOUDINARY}/v1777809187/Tank_ef7iw6.png` },
    { name: "Rox", logo: "/assets/logo-rox.webp" },
    { name: "Haval", logo: `${CLOUDINARY}/v1777809187/Haval_lkx9rr.png` },
    { name: "Leopard", logo: `${CLOUDINARY}/v1777809187/Leopard_nr8cuy.png` },
    { name: "Toyota", logo: "/assets/logo-toyota.webp" },
    { name: "Nissan", wordmark: true }, // TODO: needs a white/silver transparent PNG
    { name: "+ All cars", more: true },
  ],
};

const STEPS: Record<Locale, { n: string; title: string; body: string }[]> = {
  ar: [
    {
      n: "01",
      title: "تواصل معنا",
      body: "عبر واتساب أو بمكالمة، وأخبرنا بنوع سيارتك وما تحتاجه.",
    },
    {
      n: "02",
      title: "نحدد الموعد",
      body: "في الفرع الأقرب لك أو عبر الخدمة المنزلية. وإذا احتاجت سيارتك الورشة، نرسل البريكداون، وهو مجاني للفواتير فوق 1,000 ريال.",
    },
    {
      n: "03",
      title: "ننجز العمل",
      body: "يتولى فريقنا التركيب والبرمجة، ويمكنك التقسيط مع PayLater.",
    },
  ],
  en: [
    {
      n: "01",
      title: "Contact us",
      body: "Via WhatsApp or a call — tell us your car type and what you need.",
    },
    {
      n: "02",
      title: "We set an appointment",
      body: "At the branch nearest you, or through our home service. If your car needs the workshop, we send a tow, free on bills over 1,000 QAR.",
    },
    {
      n: "03",
      title: "We get it done",
      body: "Our team handles installation and programming, and you can pay in installments with PayLater.",
    },
  ],
};

const FAQS: Record<Locale, { q: string; a: string }[]> = {
  ar: [
    {
      q: "هل تقدمون خدمة منزلية؟",
      a: "نعم، خدمتنا المنزلية تشمل تركيب الإكسسوارات والتظليل والبرمجة، والرسوم حسب المنطقة.",
    },
    {
      q: "كم تكلفة البريكداون؟",
      a: "مجاني للفواتير فوق 1,000 ريال. إذا احتاجت سيارتك الحضور إلى الفرع، نرسل البريكداون لنقلها.",
    },
    {
      q: "هل تخدمون السيارات غير الصينية؟",
      a: "نعم. نحن متخصصون في السيارات الصينية، والعازل وPPF وقطع الغيار والصيانة متاحة لجميع السيارات.",
    },
    { q: "أي فرع أزور؟", a: "الأقرب لك. الفرعان يقدمان الخدمات نفسها، ما عدا حماية الطلاء PPF والتظليل فهما في فرع بن عمران." },
    {
      q: "هل يمكنني التقسيط؟",
      a: "نعم، عبر PayLater. يمكنك الدفع على 4 أقساط للطلبات من 300 إلى 5,999 ريال، و6 أقساط من 6,000 إلى 9,999 ريال، و12 قسطًا للطلبات من 10,000 ريال فأكثر.",
    },
  ],
  en: [
    {
      q: "Do you offer home service?",
      a: "Yes — our home service covers accessory installation, tinting and programming; fees depend on the area.",
    },
    {
      q: "How much does the breakdown/tow cost?",
      a: "Free on bills over 1,000 QAR. If your car needs to come to the branch, we send a tow truck to bring it in.",
    },
    {
      q: "Do you service non-Chinese cars?",
      a: "Yes. We specialize in Chinese cars, and insulation, PPF, spare parts and maintenance are available for all cars.",
    },
    { q: "Which branch should I visit?", a: "Whichever is closer. Both branches offer the same services, except PPF and tinting, which are at Bin Omran." },
    {
      q: "Can I pay in installments?",
      a: "Yes, with PayLater: 4 installments for orders from 300 to 5,999 QAR, 6 installments from 6,000 to 9,999 QAR, and 12 installments for orders of 10,000 QAR or more.",
    },
  ],
};

export type BookingServiceId = "accessories" | "ppf" | "tinting" | "programming" | "parts" | "maintenance";

const BOOKING_SERVICES: Record<Locale, { id: BookingServiceId; value: string; label: string }[]> = {
  ar: [
    { id: "accessories", value: "الإكسسوارات", label: "إكسسوارات" },
    { id: "ppf", value: "حماية الطلاء PPF", label: "PPF" },
    { id: "tinting", value: "العازل والتظليل", label: "تظليل" },
    { id: "programming", value: "البرمجة", label: "برمجة" },
    { id: "parts", value: "قطع الغيار", label: "قطع غيار" },
    { id: "maintenance", value: "الصيانة", label: "صيانة" },
  ],
  en: [
    { id: "accessories", value: "Accessories", label: "Accessories" },
    { id: "ppf", value: "PPF paint protection", label: "PPF" },
    { id: "tinting", value: "Insulation & tinting", label: "Tinting" },
    { id: "programming", value: "Programming", label: "Programming" },
    { id: "parts", value: "Spare parts", label: "Spare parts" },
    { id: "maintenance", value: "Maintenance", label: "Maintenance" },
  ],
};

export const SOCIAL = {
  instagram: "https://www.instagram.com/wolfcar_qa/",
  tiktok: "https://www.tiktok.com/@wolfcar_qa",
  email: "info@wolfcar.qa",
  /** Saleh (the owner) posts daily on his own Snapchat — a content channel, not a personal extra */
  salehSnap: "https://www.snapchat.com/add/saleh.wolf",
};

export const LOGO =
  "https://res.cloudinary.com/dzcq09k8h/image/upload/v1777807970/Logo-removebg-preview_mg3e4j.png";

/** WolfOS, our launcher for the BYD Leopard's screens, has its own site. */
export const WOLFOS_ORIGIN = "https://wolfcaros.com";
export const WOLFOS = {
  site: (locale: Locale) => `${WOLFOS_ORIGIN}/${locale}`,
  /** the download page with the Leopard already chosen */
  download: (locale: Locale) => `${WOLFOS_ORIGIN}/${locale}/download?brand=byd-leopard`,
  /** as WolfOS's own site gives them */
  stats: { screens: 3, apps: 61, themes: 6 },
};

/**
 * Every link to WolfOS: a new tab, so the visitor keeps our site, and where it sat on the page
 * for the visitor statistics (SiteAnalytics counts it as "wolfos").
 */
export function wolfOsLink(href: string, place: "header" | "menu" | "section" | "download") {
  return { href, target: "_blank", rel: "noopener", "data-place": place } as const;
}

export function getServices(locale: Locale) {
  return SERVICES[locale];
}
export function getCarBrands(locale: Locale) {
  return CAR_BRANDS[locale];
}
export function getWorkVideos(locale: Locale) {
  return WORK_VIDEOS[locale];
}
export function getSteps(locale: Locale) {
  return STEPS[locale];
}
export function getFaqs(locale: Locale) {
  return FAQS[locale];
}
/**
 * What cannot be booked together: PPF is never done at home, and Al Gharrafa
 * does neither PPF nor tinting (both are at Bin Omran).
 */
export function bookingServiceAvailable(service: BookingServiceId, branch: "binomran" | "gharrafa", place: "branch" | "home"): boolean {
  if (service === "ppf") return place === "branch" && branch === "binomran";
  if (service === "tinting") return branch === "binomran";
  return true;
}

export function getBookingServices(locale: Locale) {
  return BOOKING_SERVICES[locale];
}
