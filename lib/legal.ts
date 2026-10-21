import type { Locale } from "@/i18n/routing";

/**
 * Privacy policy and terms of service. DRAFTS written from what the site
 * actually does (no customer accounts, booking goes through WhatsApp, our own
 * anonymous visit counts and no third-party trackers) — have them reviewed before relying on them, and bump UPDATED
 * whenever the wording changes.
 */
export const LEGAL_UPDATED = "2026-10-09";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDoc {
  title: string;
  intro: string;
  sections: LegalSection[];
  /** "2026-10-21"; when the document changed on its own date. Defaults to LEGAL_UPDATED. */
  updated?: string;
}

const PRIVACY: Record<Locale, LegalDoc> = {
  en: {
    title: "Privacy Policy",
    intro:
      "This policy explains what information Wolf Car Auto Services (\"Wolf Car\", \"we\") receives when you use this website or contact us, and how we use it. We handle personal data in line with Qatar's Law No. 13 of 2016 on the Protection of Personal Data Privacy.",
    sections: [
      {
        heading: "What we receive",
        paragraphs: [
          "You can browse this website without creating an account or giving us any personal details.",
          "The booking form does not send anything to our servers. It prepares a WhatsApp message on your device; we only receive it if you choose to send it. When you message or call us, we receive your phone number, your name as shown on WhatsApp, and what you tell us — for example your car model, the service you need and, for home service, your address or location.",
        ],
      },
      {
        heading: "How we use it",
        paragraphs: [
          "We use this information only to reply to you, give you a quote, arrange your appointment or home-service visit, carry out the work and follow up on it (including warranty questions).",
          "We do not sell your information and we do not use it for advertising.",
        ],
      },
      {
        heading: "Stored on your device",
        paragraphs: [
          "The website remembers your language and your light or dark display choice so the page looks the way you left it. These are kept in your browser and are not used to track you.",
          "We count visits to the website ourselves, to see which pages and buttons are used: the page opened, the kind of device, the site that led you here, and presses on the WhatsApp, call and basket buttons. These counts are anonymous. They use no cookies, we do not keep your IP address, they cannot be linked to you from one day to the next, and we delete them after about a year.",
          "We do not use advertising trackers or any other company's analytics on this website.",
        ],
      },
      {
        heading: "Content from other companies",
        paragraphs: [
          "Some parts of the website are provided by other companies: the branch maps (Google Maps), our videos (TikTok and Instagram, loaded only when you press play), WhatsApp for messages, and PayLater if you choose to pay in installments. When you use these, the company concerned receives information under its own privacy policy.",
        ],
      },
      {
        heading: "Sharing",
        paragraphs: [
          "We share information only when it is needed to serve you — for example with PayLater when you ask to pay in installments — or when the law requires it.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "We keep conversations and service records for as long as they are needed to serve you, handle warranty questions and meet our legal and accounting obligations.",
        ],
      },
      {
        heading: "Your choices",
        paragraphs: [
          "You can ask us what information we hold about you, ask us to correct it, or ask us to delete it when we no longer need to keep it. Contact us by email or WhatsApp using the details at the bottom of this page.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: ["If we change this policy, we will update it on this page with a new date."],
      },
    ],
  },
  ar: {
    title: "سياسة الخصوصية",
    intro:
      "توضح هذه السياسة المعلومات التي تصل إلى وولف كار لخدمات السيارات («وولف كار» أو «نحن») عند استخدامك لهذا الموقع أو تواصلك معنا، وكيف نستخدمها. نتعامل مع البيانات الشخصية وفق القانون القطري رقم 13 لسنة 2016 بشأن حماية خصوصية البيانات الشخصية.",
    sections: [
      {
        heading: "المعلومات التي تصلنا",
        paragraphs: [
          "يمكنك تصفح هذا الموقع دون إنشاء حساب أو تقديم أي بيانات شخصية.",
          "نموذج الحجز لا يرسل أي شيء إلى خوادمنا، بل يجهّز رسالة واتساب على جهازك، ولا تصلنا إلا إذا اخترت إرسالها. عند مراسلتنا أو الاتصال بنا يصلنا رقم هاتفك واسمك كما يظهر في واتساب وما تخبرنا به، مثل موديل سيارتك والخدمة المطلوبة، وعنوانك أو موقعك في حال الخدمة المنزلية.",
        ],
      },
      {
        heading: "كيف نستخدمها",
        paragraphs: [
          "نستخدم هذه المعلومات فقط للرد عليك وتقديم عرض السعر وترتيب موعدك أو زيارة الخدمة المنزلية وتنفيذ العمل ومتابعته، بما في ذلك استفسارات الضمان.",
          "لا نبيع معلوماتك ولا نستخدمها لأغراض إعلانية.",
        ],
      },
      {
        heading: "ما يُحفظ على جهازك",
        paragraphs: [
          "يتذكر الموقع لغتك واختيارك للوضع الفاتح أو الداكن ليظهر كما تركته. تُحفظ هذه الإعدادات في متصفحك ولا تُستخدم لتتبعك.",
          "نحصي زيارات الموقع بأنفسنا لنعرف الصفحات والأزرار المستخدمة: الصفحة التي فُتحت، ونوع الجهاز، والموقع الذي جئت منه، والضغط على أزرار واتساب والاتصال والسلة. هذه الأرقام مجهولة الهوية: لا تستخدم ملفات تعريف الارتباط، ولا نحتفظ بعنوان IP الخاص بك، ولا يمكن ربطها بك من يوم إلى آخر، ونحذفها بعد نحو سنة.",
          "لا نستخدم أدوات تتبع إعلاني ولا أدوات تحليلات تابعة لشركات أخرى في هذا الموقع.",
        ],
      },
      {
        heading: "محتوى من شركات أخرى",
        paragraphs: [
          "بعض أجزاء الموقع تقدمها شركات أخرى: خرائط الفروع (خرائط Google)، ومقاطع الفيديو (تيك توك وإنستغرام، ولا تُحمّل إلا عند الضغط على التشغيل)، وواتساب للرسائل، وخدمة PayLater إذا اخترت الدفع بالتقسيط. عند استخدامها تصل بعض المعلومات إلى الشركة المعنية وفق سياسة الخصوصية الخاصة بها.",
        ],
      },
      {
        heading: "مشاركة المعلومات",
        paragraphs: [
          "لا نشارك المعلومات إلا عند الحاجة لخدمتك، مثل مشاركتها مع PayLater عند طلبك الدفع بالتقسيط، أو عندما يلزمنا القانون بذلك.",
        ],
      },
      {
        heading: "مدة الاحتفاظ",
        paragraphs: [
          "نحتفظ بالمحادثات وسجلات الخدمة طوال المدة اللازمة لخدمتك ومتابعة الضمان والوفاء بالتزاماتنا القانونية والمحاسبية.",
        ],
      },
      {
        heading: "حقوقك",
        paragraphs: [
          "يمكنك أن تطلب معرفة المعلومات التي نحتفظ بها عنك أو تصحيحها أو حذفها عندما لا تعود هناك حاجة للاحتفاظ بها. تواصل معنا عبر البريد الإلكتروني أو واتساب من خلال البيانات في أسفل هذه الصفحة.",
        ],
      },
      {
        heading: "التعديلات",
        paragraphs: ["إذا عدّلنا هذه السياسة فسننشر النسخة المحدثة في هذه الصفحة مع تاريخ جديد."],
      },
    ],
  },
};

const TERMS: Record<Locale, LegalDoc> = {
  en: {
    title: "Terms of Service",
    intro:
      "These terms apply when you use this website or book a service with Wolf Car Auto Services at our Al Gharrafa or Bin Omran branch, or through our home service.",
    sections: [
      {
        heading: "Information on this website",
        paragraphs: [
          "We keep the services and products on this website up to date, but availability varies by branch and by car model. Photos are for illustration. Product prices on the website are in Qatari riyals and may change; an order sent from the website is a request, not a purchase — our team confirms the price, stock and whether a part fits your car before you pay or any work starts.",
        ],
      },
      {
        heading: "Appointments",
        paragraphs: [
          "A booking sent through the website or WhatsApp is a request. Your appointment is confirmed once our team replies with the time. If you cannot make it, please let us know as early as you can.",
        ],
      },
      {
        heading: "Home service",
        paragraphs: [
          "Home service is available for selected services such as accessory installation, tinting and programming. The home-service fee depends on your area and is agreed with you before the visit. Please make sure there is safe space to work on the car.",
        ],
      },
      {
        heading: "Prices and payment",
        paragraphs: [
          "The price is agreed with you before we start. Any extra work that turns out to be needed is done only after you approve it.",
          "Installment payments through PayLater are subject to PayLater's approval and terms.",
        ],
      },
      {
        heading: "Warranty",
        paragraphs: [
          "Products that come with a manufacturer's warranty (for example paint protection film) are covered under that manufacturer's terms. The warranty that applies to your product or service is explained before the work and noted on your invoice. If something is not right after a service, please contact the branch that did the work as soon as possible.",
        ],
      },
      {
        heading: "Your car",
        paragraphs: [
          "Please remove valuables from the car before handing it over. We take care of every car in our workshop and will tell you straight away if we find something that needs your attention.",
        ],
      },
      {
        heading: "Names and logos",
        paragraphs: [
          "Car makers' names and logos, and the brands of the products we fit, belong to their owners and are used only to show which cars and products we work with.",
        ],
      },
      {
        heading: "Changes and governing law",
        paragraphs: [
          "We may update these terms; the version on this page applies from the date shown. These terms are governed by the laws of the State of Qatar.",
        ],
      },
    ],
  },
  ar: {
    title: "الشروط والأحكام",
    intro:
      "تنطبق هذه الشروط عند استخدامك لهذا الموقع أو حجزك لخدمة لدى وولف كار لخدمات السيارات في فرع الغرافة أو فرع بن عمران أو عبر الخدمة المنزلية.",
    sections: [
      {
        heading: "المعلومات في هذا الموقع",
        paragraphs: [
          "نحرص على تحديث الخدمات والمنتجات في هذا الموقع، لكن التوفر يختلف حسب الفرع وموديل السيارة، والصور للتوضيح فقط. أسعار المنتجات على الموقع بالريال القطري وقد تتغير، والطلب المرسل من الموقع طلبٌ وليس عملية شراء، إذ يؤكد فريقنا السعر والتوفر ومدى توافق القطعة مع سيارتك قبل الدفع أو بدء أي عمل.",
        ],
      },
      {
        heading: "المواعيد",
        paragraphs: [
          "الحجز المرسل عبر الموقع أو واتساب هو طلب موعد، ويُعتبر مؤكدًا عندما يرد فريقنا بالوقت المحدد. إذا تعذّر عليك الحضور، نرجو إبلاغنا في أقرب وقت.",
        ],
      },
      {
        heading: "الخدمة المنزلية",
        paragraphs: [
          "الخدمة المنزلية متاحة لخدمات محددة مثل تركيب الإكسسوارات والتظليل والبرمجة. تختلف رسوم الخدمة المنزلية حسب المنطقة ويتم الاتفاق عليها معك قبل الزيارة. نرجو توفير مكان آمن للعمل على السيارة.",
        ],
      },
      {
        heading: "الأسعار والدفع",
        paragraphs: [
          "يتم الاتفاق على السعر معك قبل البدء، وأي عمل إضافي يتبيّن أنه ضروري لا يُنفّذ إلا بعد موافقتك.",
          "الدفع بالتقسيط عبر PayLater يخضع لموافقة PayLater وشروطها.",
        ],
      },
      {
        heading: "الضمان",
        paragraphs: [
          "المنتجات التي يرافقها ضمان من الشركة المصنّعة (مثل فيلم حماية الطلاء) مشمولة وفق شروط تلك الشركة. نوضح لك الضمان الذي ينطبق على منتجك أو خدمتك قبل العمل ونسجّله في فاتورتك. إذا لاحظت أي مشكلة بعد الخدمة، تواصل مع الفرع الذي نفّذ العمل في أقرب وقت.",
        ],
      },
      {
        heading: "سيارتك",
        paragraphs: [
          "نرجو إخراج المقتنيات الثمينة من السيارة قبل تسليمها. نعتني بكل سيارة في ورشتنا، وسنبلغك فورًا إذا لاحظنا ما يحتاج إلى انتباهك.",
        ],
      },
      {
        heading: "الأسماء والشعارات",
        paragraphs: [
          "أسماء وشعارات شركات السيارات والعلامات التجارية للمنتجات التي نركّبها مملوكة لأصحابها، وتُستخدم فقط لتوضيح السيارات والمنتجات التي نعمل عليها.",
        ],
      },
      {
        heading: "التعديلات والقانون المطبّق",
        paragraphs: [
          "قد نحدّث هذه الشروط، وتسري النسخة المنشورة في هذه الصفحة اعتبارًا من التاريخ المذكور. تخضع هذه الشروط لقوانين دولة قطر.",
        ],
      },
    ],
  },
};

/**
 * Refund and return policy. DRAFT written for Tap's merchant review and for
 * the customers: the numbers (7 days, 3 working days) and the exclusions are
 * proposals the owner must confirm before publishing. It covers today's
 * branch and WhatsApp sales and the online card payments that come with the
 * checkout (pickup at Bin Omran; unpaid online orders expire after 30 minutes).
 */
const REFUND: Record<Locale, LegalDoc> = {
  en: {
    title: "Refund and Return Policy",
    updated: "2026-10-21",
    intro:
      "This policy explains how returns, exchanges and refunds work for parts, accessories and services bought from Wolf Car Auto Services at our Al Gharrafa or Bin Omran branch, through our home service, or paid for online on this website.",
    sections: [
      {
        heading: "Parts and accessories",
        paragraphs: [
          "You can return or exchange a part or accessory within 7 days of buying it if it has not been installed or used, it is in its original packaging and condition, and you have the invoice or order number.",
          "Parts ordered specially for your car, and electrical or electronic parts whose packaging seal has been opened, cannot be returned unless they are faulty.",
        ],
      },
      {
        heading: "Faulty or wrong parts",
        paragraphs: [
          "If a part is faulty, or does not fit the car model we confirmed with you, we will replace it or refund it in full. Please contact the branch as soon as you notice the problem.",
        ],
      },
      {
        heading: "Services and installation",
        paragraphs: [
          "Services such as paint protection film, tinting, polishing, programming and installation can be cancelled free of charge before the work starts.",
          "Once the work has started it cannot be refunded. If something is not right, we put it right under the warranty that applies to the product or service, as explained in our Terms of Service.",
        ],
      },
      {
        heading: "Orders paid online by card",
        paragraphs: [
          "If you pay for an order online and cancel it before you collect it, we refund the full amount to the same card.",
          "An online order that has not been paid is cancelled automatically after 30 minutes, and nothing is charged.",
          "If a card payment does not match your order, or you were charged twice by mistake, we refund the extra charge to the same card.",
        ],
      },
      {
        heading: "How refunds are paid",
        paragraphs: [
          "Refunds are made by the original payment method: card payments go back to the same card, and cash payments are refunded in cash or by bank transfer at the branch.",
          "We process an approved card refund within 3 working days. Your bank may then take 5 to 14 working days to show it on your statement.",
          "Purchases paid in installments through PayLater are refunded according to PayLater's terms.",
        ],
      },
      {
        heading: "How to ask for a return or refund",
        paragraphs: [
          "Contact the branch where you bought the item, or the Bin Omran branch for online orders, by phone or WhatsApp, and give us your invoice or order number. Bin Omran: +974 7100 8939. Al Gharrafa: +974 7100 7113.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "This policy does not limit your rights under Qatar's Consumer Protection Law No. 8 of 2008.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: ["If we change this policy we will publish the updated version on this page with a new date."],
      },
    ],
  },
  ar: {
    title: "سياسة الاسترجاع والاستبدال",
    updated: "2026-10-21",
    intro:
      "توضح هذه السياسة كيفية الاسترجاع والاستبدال واسترداد المبالغ للقطع والإكسسوارات والخدمات التي تشتريها من وولف كار لخدمات السيارات في فرع الغرافة أو فرع بن عمران، أو عبر الخدمة المنزلية، أو بالدفع الإلكتروني على هذا الموقع.",
    sections: [
      {
        heading: "القطع والإكسسوارات",
        paragraphs: [
          "يمكنك استرجاع أو استبدال القطعة أو الإكسسوار خلال 7 أيام من تاريخ الشراء إذا لم يتم تركيبها أو استخدامها، وكانت في غلافها وحالتها الأصلية، ومعك الفاتورة أو رقم الطلب.",
          "لا يمكن استرجاع القطع المطلوبة خصيصًا لسيارتك، ولا القطع الكهربائية أو الإلكترونية بعد فتح ختم غلافها، إلا إذا كانت معيبة.",
        ],
      },
      {
        heading: "القطع المعيبة أو غير المطابقة",
        paragraphs: [
          "إذا كانت القطعة معيبة أو غير مناسبة لموديل السيارة الذي أكدناه معك، نستبدلها أو نعيد لك المبلغ كاملًا. نرجو التواصل مع الفرع فور ملاحظة المشكلة.",
        ],
      },
      {
        heading: "الخدمات والتركيب",
        paragraphs: [
          "يمكن إلغاء الخدمات مثل فيلم حماية الطلاء والتظليل والتلميع والبرمجة والتركيب دون أي رسوم قبل بدء العمل.",
          "بعد بدء العمل لا يمكن استرداد المبلغ، وإذا لم تكن النتيجة كما يجب نعالجها وفق الضمان الذي ينطبق على المنتج أو الخدمة كما هو موضح في الشروط والأحكام.",
        ],
      },
      {
        heading: "الطلبات المدفوعة بالبطاقة عبر الموقع",
        paragraphs: [
          "إذا دفعت قيمة طلبك عبر الموقع وألغيته قبل استلامه، نعيد لك المبلغ كاملًا إلى البطاقة نفسها.",
          "يُلغى الطلب الإلكتروني غير المدفوع تلقائيًا بعد 30 دقيقة، ولا يُخصم أي مبلغ.",
          "إذا لم يطابق المبلغ المدفوع قيمة طلبك، أو خُصم منك المبلغ مرتين عن طريق الخطأ، نعيد المبلغ الزائد إلى البطاقة نفسها.",
        ],
      },
      {
        heading: "طريقة إعادة المبلغ",
        paragraphs: [
          "نعيد المبلغ بطريقة الدفع الأصلية: المدفوعات بالبطاقة تُعاد إلى البطاقة نفسها، والمدفوعات النقدية تُعاد نقدًا أو بتحويل بنكي في الفرع.",
          "ننفّذ استرداد المبلغ إلى البطاقة خلال 3 أيام عمل من الموافقة عليه، وقد يستغرق البنك بعد ذلك من 5 إلى 14 يوم عمل لإظهاره في كشف حسابك.",
          "المشتريات المدفوعة بالتقسيط عبر PayLater يُعاد مبلغها وفق شروط PayLater.",
        ],
      },
      {
        heading: "كيف تطلب الاسترجاع أو استرداد المبلغ",
        paragraphs: [
          "تواصل مع الفرع الذي اشتريت منه، أو مع فرع بن عمران للطلبات الإلكترونية، بالاتصال أو عبر واتساب، وزوّدنا برقم الفاتورة أو رقم الطلب. فرع بن عمران: \u2066+974 7100 8939\u2069. فرع الغرافة: \u2066+974 7100 7113\u2069.",
        ],
      },
      {
        heading: "حقوقك",
        paragraphs: ["لا تحدّ هذه السياسة من حقوقك وفق قانون حماية المستهلك القطري رقم (8) لسنة 2008."],
      },
      {
        heading: "التعديلات",
        paragraphs: ["إذا عدّلنا هذه السياسة فسننشر النسخة المحدثة في هذه الصفحة مع تاريخ جديد."],
      },
    ],
  },
};

export function getPrivacy(locale: Locale) {
  return PRIVACY[locale];
}
export function getTerms(locale: Locale) {
  return TERMS[locale];
}
export function getRefund(locale: Locale) {
  return REFUND[locale];
}
