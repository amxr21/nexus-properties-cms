import type { Core } from '@strapi/strapi';
import path from 'path';
import fs from 'fs';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureLocales(strapi);
    await ensurePublicPermissions(strapi);
    await seedAllContent(strapi);
  },
};

// ── Locales ───────────────────────────────────────────────────────────────────

async function ensureLocales(strapi: Core.Strapi) {
  const localeService = strapi.plugin('i18n').service('locales');
  const existing: { code: string }[] = await localeService.find();
  const codes = existing.map((l) => l.code);

  if (!codes.includes('en')) {
    await localeService.create({ code: 'en', name: 'English (en)', isDefault: true });
    strapi.log.info('[seed] Created locale: en');
  }
  if (!codes.includes('ar')) {
    await localeService.create({ code: 'ar', name: 'Arabic (ar)' });
    strapi.log.info('[seed] Created locale: ar');
  }
}

// ── Public Permissions ────────────────────────────────────────────────────────

async function ensurePublicPermissions(strapi: Core.Strapi) {
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) return;

  const contentTypes = [
    'api::project.project',
    'api::team-member.team-member',
    'api::service.service',
    'api::blog-post.blog-post',
    'api::career.career',
    'api::homepage.homepage',
    'api::site-setting.site-setting',
    'api::privacy-policy.privacy-policy',
    'api::terms-of-service.terms-of-service',
    'api::cookie-policy.cookie-policy',
    'api::disclaimer.disclaimer',
    'api::accessibility-statement.accessibility-statement',
  ];

  const actions: string[] = [];
  for (const ct of contentTypes) {
    const [, apiPart] = ct.split('::');
    const [, name] = apiPart.split('.');
    actions.push(`api::${name}.${name}.find`);
    actions.push(`api::${name}.${name}.findOne`);
  }

  actions.push('plugin::upload.content-api.find');
  actions.push('plugin::upload.content-api.findOne');

  const existingPerms = await strapi
    .query('plugin::users-permissions.permission')
    .findMany({ where: { role: publicRole.id } });

  const existingActions = existingPerms.map((p: { action: string }) => p.action);

  for (const action of actions) {
    if (!existingActions.includes(action)) {
      await strapi.query('plugin::users-permissions.permission').create({
        data: { action, role: publicRole.id },
      });
    }
  }

  strapi.log.info('[seed] Public permissions configured');
}

// ── Media helper ──────────────────────────────────────────────────────────────

async function getOrUploadMedia(strapi: Core.Strapi, filename: string): Promise<number | null> {
  const existing = await strapi.db.query('plugin::upload.file').findOne({
    where: { name: filename },
  });
  if (existing) return existing.id;

  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath)) {
    strapi.log.warn(`[seed] Image not found: ${filePath}`);
    return null;
  }

  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

    // Strapi v5 upload service expects filepath + originalFilename + mimetype (not path/name/type)
    const uploadedFiles = await strapi.plugin('upload').service('upload').upload({
      data: {},
      files: {
        filepath: filePath,
        originalFilename: filename,
        mimetype: mimeType,
        size: stats.size,
      },
    });

    return uploadedFiles?.[0]?.id ?? null;
  } catch (err) {
    strapi.log.warn(`[seed] Failed to upload ${filename}: ${err}`);
    return null;
  }
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function countEntries(strapi: Core.Strapi, uid: string): Promise<number> {
  try {
    return await strapi.db.query(uid).count({});
  } catch {
    return 0;
  }
}

// Strapi v5: create EN entry, then create AR entry sharing the same documentId
async function createWithLocale(
  strapi: Core.Strapi,
  uid: string,
  enData: Record<string, unknown>,
  arData: Record<string, unknown>,
) {
  const doc = await (strapi.documents as any)(uid).create({
    data: enData,
    locale: 'en',
    status: 'published',
  });

  // Pass documentId in data so Strapi links AR as a localization of the same document
  await (strapi.documents as any)(uid).create({
    data: { ...arData, documentId: doc.documentId },
    locale: 'ar',
    status: 'published',
  });

  return doc;
}

// For single types: create EN, then update the same documentId with AR locale
async function createSingleTypeWithLocale(
  strapi: Core.Strapi,
  uid: string,
  enData: Record<string, unknown>,
  arData: Record<string, unknown>,
) {
  const existing = await strapi.db.query(uid).findOne({});

  if (existing) {
    return existing;
  }

  const doc = await (strapi.documents as any)(uid).create({
    data: enData,
    locale: 'en',
    status: 'published',
  });

  // For single types, update adds the AR locale to the same document
  await (strapi.documents as any)(uid).update({
    documentId: doc.documentId,
    data: arData,
    locale: 'ar',
    status: 'published',
  });

  return doc;
}

// ── Main seed ─────────────────────────────────────────────────────────────────

async function seedAllContent(strapi: Core.Strapi) {
  await seedTeamMembers(strapi);
  await seedProjects(strapi);
  await seedServices(strapi);
  await seedBlogPosts(strapi);
  await seedCareers(strapi);
  await seedHomepage(strapi);
  await seedSiteSettings(strapi);
  await seedLegalPages(strapi);
}

// ── Team Members ──────────────────────────────────────────────────────────────

async function seedTeamMembers(strapi: Core.Strapi) {
  const count = await countEntries(strapi, 'api::team-member.team-member');
  if (count > 0) return;

  strapi.log.info('[seed] Seeding team members...');

  const members = [
    {
      en: { name: 'James Carter', role: 'Founder & CEO' },
      ar: { name: 'جيمس كارتر', role: 'المؤسس والرئيس التنفيذي' },
      image: 'worker_1.jpg',
      order: 1,
    },
    {
      en: { name: 'Sarah Mitchell', role: 'Head of Sales' },
      ar: { name: 'سارة ميتشيل', role: 'رئيسة المبيعات' },
      image: 'worker_2.jpg',
      order: 2,
    },
    {
      en: { name: 'Marcus Lee', role: 'Lead Architect' },
      ar: { name: 'ماركوس لي', role: 'كبير المهندسين المعماريين' },
      image: 'worker_3.jpg',
      order: 3,
    },
    {
      en: { name: 'David Okafor', role: 'Client Relations' },
      ar: { name: 'ديفيد أوكافور', role: 'علاقات العملاء' },
      image: 'worker_4.jpg',
      order: 4,
    },
  ];

  for (const m of members) {
    const imageId = await getOrUploadMedia(strapi, m.image);

    await createWithLocale(
      strapi,
      'api::team-member.team-member',
      { name: m.en.name, role: m.en.role, order: m.order, image: imageId },
      { name: m.ar.name, role: m.ar.role, order: m.order, image: imageId },
    );
  }

  strapi.log.info('[seed] Team members seeded');
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function seedProjects(strapi: Core.Strapi) {
  const count = await countEntries(strapi, 'api::project.project');
  if (count > 0) return;

  strapi.log.info('[seed] Seeding projects...');

  const projects = [
    {
      slug: 'lamar-collective',
      status: 'ongoing',
      image: 'project_image.jpg',
      en: {
        title: 'The Lamar Collective',
        meta: 'South Austin · Mixed-Use Development · Est. Completion Q4 2025',
        brief: 'A landmark mixed-use development redefining South Austin\'s skyline — 240 luxury residences, ground-floor retail, and world-class amenities.',
        body: 'A landmark mixed-use development redefining South Austin\'s skyline. The Lamar Collective combines 240 luxury residences with ground-floor retail and world-class amenities — all within walking distance of Austin\'s most vibrant cultural corridor.',
        imageAlt: 'The Lamar Collective development',
        detail: {
          location: 'South Austin, TX',
          type: 'Mixed-Use Development',
          units: '240 Residences',
          size: 'From 650 – 2,400 sq ft',
          floors: '14 Floors',
          residenceFeatures: ['Floor-to-ceiling windows with city views','Private balconies on select units','Gourmet kitchen with quartz countertops','In-unit washer & dryer','Smart home technology pre-installed','Secure underground parking'],
          buildingAmenities: ['Resort-style rooftop pool & lounge','State-of-the-art fitness center','Co-working & private meeting suites','Ground-floor curated retail & dining','Concierge services 7 days a week','Pet-friendly with dedicated dog run','EV charging stations','Bike storage & repair station'],
          locationHighlights: ['LEED Silver certified construction','Walking distance to Barton Springs & Zilker Park','Steps from Austin\'s most vibrant cultural corridor','Direct access to Austin MetroRapid transit'],
        },
      },
      ar: {
        title: 'مجمع لامار',
        meta: 'جنوب أوستن · تطوير متعدد الاستخدامات · الإنجاز المتوقع الربع الرابع 2025',
        brief: 'تطوير متعدد الاستخدامات يُعيد تشكيل أفق جنوب أوستن — 240 وحدة سكنية فاخرة ومحلات تجارية ومرافق عالمية المستوى.',
        body: 'تطوير متعدد الاستخدامات يُعيد تشكيل أفق جنوب أوستن. يجمع مجمع لامار 240 وحدة سكنية فاخرة مع محلات تجارية في الطابق الأرضي ومرافق عالمية المستوى.',
        imageAlt: 'مشروع مجمع لامار',
        detail: {
          location: 'جنوب أوستن، تكساس',
          type: 'تطوير متعدد الاستخدامات',
          units: '240 وحدة سكنية',
          size: 'من 650 إلى 2,400 قدم مربع',
          floors: '14 طابقاً',
          residenceFeatures: ['نوافذ من الأرض إلى السقف بإطلالات على المدينة','شرفات خاصة في وحدات مختارة','مطبخ فاخر مع أسطح كوارتز','غسالة ومجفف داخل الوحدة','تقنية المنزل الذكي مثبتة مسبقاً','موقف سيارات آمن تحت الأرض'],
          buildingAmenities: ['حمام سباحة على السطح وصالة ترفيهية بطابع المنتجع','مركز لياقة بدنية متطور','مساحات عمل مشتركة وغرف اجتماعات خاصة','محلات تجارية ومطاعم مختارة في الطابق الأرضي','خدمات الكونسيرج 7 أيام في الأسبوع','صديق للحيوانات الأليفة مع حديقة مخصصة للكلاب','محطات شحن للسيارات الكهربائية','تخزين الدراجات ومحطة صيانة'],
          locationHighlights: ['بناء حاصل على شهادة LEED الفضية','مسافة المشي من ينابيع بارتون وبارك زيلكر','خطوات من أكثر الممرات الثقافية حيوية في أوستن','وصول مباشر إلى شبكة MetroRapid في أوستن'],
        },
      },
    },
    {
      slug: 'eastside-yard',
      status: 'ongoing',
      image: 'showoff_section_image_4.jpg',
      en: {
        title: 'Eastside Yard',
        meta: 'East Austin · Mixed-Use Development · Est. Completion Q2 2026',
        brief: 'A creative mixed-use campus in East Austin anchored by live-work lofts, maker studios, and a curated food hall spanning three city blocks.',
        body: 'Eastside Yard reimagines three underutilized city blocks in East Austin as a thriving creative campus. The development features 120 live-work lofts, 60,000 sq ft of maker and creative studio space, and a 12,000 sq ft food hall curated by Austin\'s most celebrated chefs.',
        imageAlt: 'Eastside Yard development',
        detail: {
          location: 'East Austin, TX',
          type: 'Mixed-Use Creative Campus',
          units: '120 Live-Work Lofts',
          size: 'From 800 – 1,800 sq ft',
          floors: '8 Floors',
          residenceFeatures: ['Polished concrete floors & exposed ductwork','Soaring 14-ft ceilings','Industrial-chic kitchen with gas range','Private studio mezzanine in select units','High-speed fiber internet infrastructure','Dedicated maker storage rooms'],
          buildingAmenities: ['60,000 sq ft of maker & creative studio space','12,000 sq ft curated food hall','Outdoor event lawn & amphitheater','Rooftop bar & garden terrace','Dedicated freight elevator for studios','On-site gallery & exhibition space','Childcare center','Secure bike valet'],
          locationHighlights: ['Three city blocks of activated streetscape','Anchor tenant partnerships with local creative brands','Adjacent to East 6th Street entertainment district','Public art installation program'],
        },
      },
      ar: {
        title: 'إيستسايد يارد',
        meta: 'شرق أوستن · تطوير متعدد الاستخدامات · الإنجاز المتوقع الربع الثاني 2026',
        brief: 'حرم إبداعي متعدد الاستخدامات في شرق أوستن يضم شققاً للعيش والعمل واستوديوهات إبداعية وقاعة طعام مختارة تمتد على ثلاثة بنايات.',
        body: 'يُعيد إيستسايد يارد تصور ثلاثة بنايات متجاورة في شرق أوستن كحرم إبداعي نابض بالحياة. يضم المشروع 120 شقة للعيش والعمل، و60,000 قدم مربع من استوديوهات الإبداع، وقاعة طعام مساحتها 12,000 قدم مربع.',
        imageAlt: 'مشروع إيستسايد يارد',
        detail: {
          location: 'شرق أوستن، تكساس',
          type: 'حرم إبداعي متعدد الاستخدامات',
          units: '120 شقة للعيش والعمل',
          size: 'من 800 إلى 1,800 قدم مربع',
          floors: '8 طوابق',
          residenceFeatures: ['أرضيات خرسانة مصقولة وقنوات مكشوفة','أسقف مرتفعة 14 قدماً','مطبخ بتصميم صناعي مع موقد غاز','ميزانين استوديو خاص في وحدات مختارة','بنية تحتية للإنترنت الليفي فائق السرعة','غرف تخزين مخصصة للمبدعين'],
          buildingAmenities: ['60,000 قدم مربع من مساحات الاستوديو الإبداعي','قاعة طعام 12,000 قدم مربع','ساحة فعاليات خارجية ومسرح','بار على السطح وحديقة تراسية','مصعد شحن مخصص للاستوديوهات','معرض ومساحة عرض في الموقع','مركز رعاية الأطفال','حارس دراجات آمن'],
          locationHighlights: ['ثلاثة بنايات من الواجهات التجارية النشطة','شراكات مع العلامات الإبداعية المحلية','مجاور لحي الترفيه في الشارع السادس الشرقي','برنامج تركيب الفن العام'],
        },
      },
    },
    {
      slug: 'domain-north-tower',
      status: 'ongoing',
      image: 'showoff_section_image_6.jpg',
      en: {
        title: 'Domain North Tower',
        meta: 'The Domain · Class-A Office · Est. Completion Q1 2027',
        brief: 'A 28-story Class-A office tower at The Domain, positioning Nexus at the forefront of Austin\'s booming tech corridor.',
        body: 'Domain North Tower will be the defining landmark of Austin\'s fastest-growing tech corridor. The 28-story tower delivers 520,000 sq ft of LEED Platinum-certified workspace, ground-level retail activation, and a rooftop amenity deck with panoramic views across Austin.',
        imageAlt: 'Domain North Tower rendering',
        detail: {
          location: 'The Domain, Austin, TX',
          type: 'Class-A Office Tower',
          units: '520,000 sq ft Office Space',
          size: 'Floors 2–28 available',
          floors: '28 Floors',
          residenceFeatures: ['Column-free floor plates up to 24,000 sq ft','Floor-to-ceiling glazing with solar shading','Private terraces on floors 10, 18, & 28','Fiber-optic & redundant power infrastructure','LEED Platinum pursuit certification','Advanced HVAC with MERV-16 filtration'],
          buildingAmenities: ['Panoramic rooftop amenity deck','Full-service conference & event center','Premium fitness center & locker rooms','Ground-floor dining & retail activation','Secure parking at 3:1,000 ratio','EV charging for 30% of stalls','Bike valet & full shower facilities','On-site property management'],
          locationHighlights: ['Positioned at the gateway to The Domain tech corridor','Adjacent to Apple, Amazon, Meta, and Google campuses','Direct connection to MetroRail Red Line','WELL Building Standard certification targeted'],
        },
      },
      ar: {
        title: 'برج دومين نورث',
        meta: 'ذا دومين · مكاتب الفئة A · الإنجاز المتوقع الربع الأول 2027',
        brief: 'برج مكتبي من الفئة A يضم 28 طابقاً في ذا دومين، يُرسّخ مكانة نكسس في قلب ممر التكنولوجيا المزدهر بأوستن.',
        body: 'سيكون برج دومين نورث المعلم المحوري في أسرع ممرات التكنولوجيا نمواً في أوستن. يوفر البرج الواقع على 28 طابقاً ما يزيد على 520,000 قدم مربع من مساحات العمل الحائزة على شهادة LEED البلاتينية.',
        imageAlt: 'تصور برج دومين نورث',
        detail: {
          location: 'ذا دومين، أوستن، تكساس',
          type: 'برج مكتبي من الفئة A',
          units: '520,000 قدم مربع مساحة مكتبية',
          size: 'الطوابق 2-28 متاحة',
          floors: '28 طابقاً',
          residenceFeatures: ['لوحات طوابق خالية من الأعمدة حتى 24,000 قدم مربع','زجاج من الأرض إلى السقف مع حماية شمسية','تراسات خاصة في الطوابق 10 و18 و28','بنية تحتية للألياف الضوئية وطاقة احتياطية','شهادة LEED البلاتينية المرشحة','أنظمة تكييف متقدمة مع فلترة MERV-16'],
          buildingAmenities: ['طابق ترفيهي بانورامي على السطح','مركز مؤتمرات وفعاليات متكامل','مركز لياقة بدنية مميز وغرف مع دش','مطاعم ومحلات تجارية في الطابق الأرضي','موقف سيارات آمن بنسبة 3:1,000','شحن كهربائي لـ 30% من المواقف','حارس دراجات ومرافق دش كاملة','إدارة عقارية في الموقع'],
          locationHighlights: ['في بوابة ممر التكنولوجيا في ذا دومين','مجاور لمقار Apple وAmazon وMeta وGoogle','وصول مباشر إلى الخط الأحمر لـ MetroRail','مستهدف الحصول على شهادة معيار WELL للبناء'],
        },
      },
    },
    {
      slug: 'congress-plaza',
      status: 'completed',
      image: 'showoff_section_image_3.jpg',
      en: {
        title: 'Congress Plaza',
        meta: 'Downtown Austin · Commercial Office · Completed Q2 2023',
        brief: 'A 22-story Class-A office tower at the heart of Congress Avenue, redefining Austin\'s downtown skyline with premium workspace and retail.',
        body: 'Congress Plaza stands as a testament to Nexus\'s commitment to commercial excellence. This 22-story Class-A office tower delivers 380,000 sq ft of premium workspace across downtown Austin, featuring LEED Platinum certification, panoramic city views, and a curated ground-floor retail experience.',
        imageAlt: 'Congress Plaza office tower',
        detail: {
          location: 'Downtown Austin, TX',
          type: 'Class-A Commercial Office',
          units: '380,000 sq ft',
          size: 'Floors 3–22 available',
          floors: '22 Floors',
          residenceFeatures: ['Efficient 18,000 sq ft floor plates','Triple-glazed curtain wall façade','Private balconies on corner suites','Built-in data center infrastructure','LEED Platinum certified','24/7 secured access control'],
          buildingAmenities: ['Signature restaurant on ground floor','Fitness & wellness center with spa','Conference center with AV package','Rooftop terrace with panoramic views','Valet & self-park garage','Concierge & building management','On-site dry cleaning & postal services','EV charging infrastructure'],
          locationHighlights: ['Congress Avenue address with Capitol views','Walking distance to Austin City Hall','Surrounded by Austin\'s premier dining & culture','WELL Building Standard Gold certification'],
        },
      },
      ar: {
        title: 'كونغرس بلازا',
        meta: 'وسط أوستن · مكاتب تجارية · اكتمل الربع الثاني 2023',
        brief: 'برج مكتبي من الفئة A يضم 22 طابقاً في قلب شارع كونغرس، يُعيد تعريف أفق وسط أوستن بمساحات عمل راقية ومتاجر متميزة.',
        body: 'يُجسّد كونغرس بلازا التزام نكسس بالتميز التجاري. يوفر هذا البرج المكتبي من الفئة A البالغ 22 طابقاً ما يزيد على 380,000 قدم مربع من مساحات العمل الراقية في وسط أوستن.',
        imageAlt: 'برج كونغرس بلازا المكتبي',
        detail: {
          location: 'وسط مدينة أوستن، تكساس',
          type: 'مكتب تجاري من الفئة A',
          units: '380,000 قدم مربع',
          size: 'الطوابق 3-22 متاحة',
          floors: '22 طابقاً',
          residenceFeatures: ['لوحات طوابق فعالة بمساحة 18,000 قدم مربع','واجهة زجاجية ثلاثية التزجيج','شرفات خاصة في الأجنحة الركنية','بنية تحتية لمراكز البيانات','شهادة LEED البلاتينية','تحكم آمن في الدخول على مدار الساعة'],
          buildingAmenities: ['مطعم مميز في الطابق الأرضي','مركز لياقة وصحة مع سبا','مركز مؤتمرات مع حزمة صوت وصورة','تراس على السطح بإطلالات بانورامية','موقف سيارات بخدمة الفاليه والذاتي','كونسيرج وإدارة المبنى','خدمات التنظيف الجاف والبريد في الموقع','بنية تحتية لشحن السيارات الكهربائية'],
          locationHighlights: ['عنوان شارع كونغرس بإطلالات على مبنى الكابيتول','مسافة المشي من بلدية مدينة أوستن','محاط بأبرز المطاعم والمعالم الثقافية في أوستن','شهادة معيار WELL للبناء الذهبية'],
        },
      },
    },
    {
      slug: 'barton-heights',
      status: 'completed',
      image: 'showoff_section_image_5.jpg',
      en: {
        title: 'Barton Heights Residences',
        meta: 'Barton Hills · Residential · Completed Q4 2022',
        brief: 'An intimate collection of 48 bespoke residences nestled in Barton Hills, blending modern architecture with Austin\'s natural landscape.',
        body: 'Barton Heights Residences represent the finest in boutique residential development. Forty-eight bespoke homes are carefully sited within Barton Hills\' rolling terrain, each designed to capture sweeping Hill Country views.',
        imageAlt: 'Barton Heights residential development',
        detail: {
          location: 'Barton Hills, Austin, TX',
          type: 'Boutique Residential',
          units: '48 Bespoke Homes',
          size: '2,200 – 4,800 sq ft',
          floors: '2–3 Floors per home',
          residenceFeatures: ['Hill Country limestone & cedar exteriors','Chef\'s kitchen with Thermador appliances','Primary suite with spa bath & soaking tub','Private pool & outdoor kitchen on select lots','Three-car garages with workshop space','Whole-home automation system'],
          buildingAmenities: ['Gated community with 24-hr security','Residents-only hiking trail network','Neighborhood park & picnic area','Shared garden & orchard','Community clubhouse for private events','Proximity to Barton Creek Greenbelt','HOA-managed landscaping','Guest parking & visitor management'],
          locationHighlights: ['Backing directly onto Barton Creek Greenbelt','Minutes from Barton Springs Pool','Top-rated AISD school district','Each home sited for maximum privacy'],
        },
      },
      ar: {
        title: 'مساكن بارتون هايتس',
        meta: 'تلال بارتون · سكني · اكتمل الربع الرابع 2022',
        brief: 'مجموعة حصرية من 48 وحدة سكنية مصممة بعناية في تلال بارتون، تمزج العمارة العصرية مع الطبيعة الخلابة لأوستن.',
        body: 'تُمثّل مساكن بارتون هايتس الرقي في التطوير السكني الفاخر. ثمانية وأربعون منزلاً حصرياً مُصمَّمة بعناية فائقة ضمن تضاريس تلال بارتون.',
        imageAlt: 'مشروع مساكن بارتون هايتس',
        detail: {
          location: 'تلال بارتون، أوستن، تكساس',
          type: 'سكني بوتيك',
          units: '48 منزلاً مصمماً خصيصاً',
          size: '2,200 - 4,800 قدم مربع',
          floors: '2-3 طوابق لكل منزل',
          residenceFeatures: ['واجهات حجر الجير والأرز من هيل كانتري','مطبخ شيف مع أجهزة Thermador','جناح رئيسي مع حمام سبا وحوض استحمام','مسبح خاص ومطبخ خارجي في قطع مختارة','كراجات ثلاثية السيارات مع مساحة عمل','نظام أتمتة المنزل الكامل'],
          buildingAmenities: ['مجتمع مسوّر مع أمن 24 ساعة','شبكة ممرات مشي حصرية للسكان','حديقة الحي ومنطقة النزهات','حديقة وبستان مشترك','نادي المجتمع للفعاليات الخاصة','قرب من خضراء بارتون كريك','تنسيق الحدائق بإدارة جمعية الملاك','موقف السيارات للضيوف وإدارة الزوار'],
          locationHighlights: ['يطل مباشرة على خضراء بارتون كريك','دقائق من بارتون سبرينغز بول','منطقة مدرسية AISD المصنفة الأعلى','كل منزل موضوع لأقصى قدر من الخصوصية'],
        },
      },
    },
    {
      slug: 'rainey-lofts',
      status: 'completed',
      image: 'hero-card_3.jpg',
      en: {
        title: 'Rainey Street Lofts',
        meta: 'Rainey Street · Residential · Completed Q1 2022',
        brief: 'Seventy-two industrial-chic lofts rising above Austin\'s most celebrated entertainment district, steps from the city\'s finest bars and restaurants.',
        body: 'Rainey Street Lofts deliver an unparalleled urban lifestyle at the epicenter of Austin\'s cultural scene. Seventy-two meticulously designed residences feature exposed concrete, soaring ceilings, and floor-to-ceiling windows overlooking the vibrant Rainey Street corridor.',
        imageAlt: 'Rainey Street Lofts building',
        detail: {
          location: 'Rainey Street, Austin, TX',
          type: 'Urban Residential Lofts',
          units: '72 Loft Residences',
          size: '680 – 1,600 sq ft',
          floors: '10 Floors',
          residenceFeatures: ['Exposed concrete ceilings at 11 ft','Polished concrete & hardwood floors','Open-concept kitchen with waterfall island','Floor-to-ceiling steel-framed windows','Private juliet balconies','In-unit Bosch washer/dryer stack'],
          buildingAmenities: ['Rooftop terrace overlooking Rainey Street','Resort pool & outdoor lounge','Fitness studio with Peloton bikes','Ground-floor bar & coffee lounge','Controlled-access parking garage','Package concierge & cold storage','Dog spa & grooming station','Co-working lounge with private pods'],
          locationHighlights: ['Steps from Austin\'s most celebrated bar scene','Walk score of 94 — walker\'s paradise','Lady Bird Lake hike & bike trail access','Surrounded by James Beard-nominated restaurants'],
        },
      },
      ar: {
        title: 'شقق راينى ستريت',
        meta: 'شارع راينى · سكني · اكتمل الربع الأول 2022',
        brief: 'اثنتان وسبعون شقة بأسلوب صناعي راقٍ فوق أشهر حي ترفيهي في أوستن، على بُعد خطوات من أبرز المطاعم والمقاهي.',
        body: 'تُقدّم شقق راينى ستريت أسلوب حياة حضري لا مثيل له في قلب المشهد الثقافي بأوستن.',
        imageAlt: 'مبنى شقق راينى ستريت',
        detail: {
          location: 'راينى ستريت، أوستن، تكساس',
          type: 'شقق لوفت حضرية سكنية',
          units: '72 شقة لوفت',
          size: '680 - 1,600 قدم مربع',
          floors: '10 طوابق',
          residenceFeatures: ['أسقف خرسانية مكشوفة بارتفاع 11 قدماً','أرضيات خرسانة مصقولة وخشب طبيعي','مطبخ مفتوح مع جزيرة شلالية','نوافذ من الأرض إلى السقف بإطار فولاذي','شرفات جولييت خاصة','غسالة ومجفف Bosch مدمجان في الوحدة'],
          buildingAmenities: ['تراس على السطح يطل على راينى ستريت','مسبح بطابع المنتجع وصالة خارجية','استوديو لياقة مع دراجات بيلوتون','بار وكافيه في الطابق الأرضي','موقف سيارات بدخول مسيطر عليه','كونسيرج للطرود وتخزين مبرد','سبا وصالة العناية بالحيوانات الأليفة','مساحة عمل مشتركة مع أماكن خاصة'],
          locationHighlights: ['خطوات من أشهر حي بارات في أوستن','تقييم سيراً على الأقدام 94 — جنة المشاة','وصول إلى ممر المشي والدراجات على بحيرة ليدي بيرد','محاط بمطاعم مرشحة لجائزة جيمس بيرد'],
        },
      },
    },
    {
      slug: 'mueller-commons',
      status: 'completed',
      image: 'hero-card_4.jpg',
      en: {
        title: 'Mueller Commons',
        meta: 'Mueller District · Mixed-Use · Completed Q3 2021',
        brief: 'A walkable mixed-use community anchoring the Mueller District, with 160 residences, neighborhood retail, and green park frontage.',
        body: 'Mueller Commons exemplifies Nexus\'s vision for sustainable, community-centered development. One hundred and sixty residences sit above 40,000 sq ft of neighborhood-serving retail, all oriented around a central park.',
        imageAlt: 'Mueller Commons development',
        detail: {
          location: 'Mueller District, Austin, TX',
          type: 'Mixed-Use Community',
          units: '160 Residences',
          size: '720 – 1,900 sq ft',
          floors: '6 Floors',
          residenceFeatures: ['Energy-efficient double-pane windows','Quartz countertops & tile backsplash','Stainless Whirlpool appliance package','Private patios on ground-level units','Flexible open floorplans','Walk-in closets in all bedrooms'],
          buildingAmenities: ['40,000 sq ft neighborhood retail below','Central park with fountain & seating','Hike-and-bike trail network','Community pool & splash pad','Fitness center & yoga studio','Children\'s playground','Farmers market pavilion','Underground secured parking'],
          locationHighlights: ['Mueller central park frontage','Walkable to Mueller\'s retail & dining','Sustainable design with solar canopies','Connected to citywide trail system'],
        },
      },
      ar: {
        title: 'مولر كومنز',
        meta: 'حي مولر · متعدد الاستخدامات · اكتمل الربع الثالث 2021',
        brief: 'مجتمع متعدد الاستخدامات قابل للمشي يُرسّخ حضور نكسس في حي مولر، بـ160 وحدة سكنية ومتاجر محلية وواجهة حديقة خضراء.',
        body: 'يجسّد مولر كومنز رؤية نكسس للتطوير المستدام المتمحور حول المجتمع. تقع مائة وستون وحدة سكنية فوق 40,000 قدم مربع من المتاجر.',
        imageAlt: 'مشروع مولر كومنز',
        detail: {
          location: 'حي مولر، أوستن، تكساس',
          type: 'مجتمع متعدد الاستخدامات',
          units: '160 وحدة سكنية',
          size: '720 - 1,900 قدم مربع',
          floors: '6 طوابق',
          residenceFeatures: ['نوافذ مزدوجة موفرة للطاقة','أسطح كوارتز وبلاط ديكوري','حزمة أجهزة Whirlpool الستانلس ستيل','فناءات خاصة في وحدات الطابق الأرضي','مخططات مفتوحة مرنة','غرف خزانة واسعة في جميع غرف النوم'],
          buildingAmenities: ['40,000 قدم مربع من التجزئة السكنية أسفل المبنى','حديقة مركزية مع نافورة ومقاعد','شبكة ممرات المشي والدراجات','مسبح المجتمع ومنطقة الاستجمام المائي','مركز لياقة واستوديو يوغا','ملعب الأطفال','جناح سوق المزارعين','موقف سيارات آمن تحت الأرض'],
          locationHighlights: ['واجهة على الحديقة المركزية في مولر','قابل للمشي إلى محلات ومطاعم مولر','تصميم مستدام مع ألواح شمسية','متصل بشبكة المسارات على مستوى المدينة'],
        },
      },
    },
  ];

  for (const p of projects) {
    const imageId = await getOrUploadMedia(strapi, p.image);

    await createWithLocale(
      strapi,
      'api::project.project',
      {
        title: p.en.title,
        slug: p.slug,
        status: p.status,
        meta: p.en.meta,
        brief: p.en.brief,
        body: p.en.body,
        imageAlt: p.en.imageAlt,
        detail: p.en.detail,
        image: imageId,
      },
      {
        title: p.ar.title,
        slug: p.slug,
        status: p.status,
        meta: p.ar.meta,
        brief: p.ar.brief,
        body: p.ar.body,
        imageAlt: p.ar.imageAlt,
        detail: p.ar.detail,
        image: imageId,
      },
    );
  }

  strapi.log.info('[seed] Projects seeded');
}

// ── Services ──────────────────────────────────────────────────────────────────

async function seedServices(strapi: Core.Strapi) {
  const count = await countEntries(strapi, 'api::service.service');
  if (count > 0) return;

  strapi.log.info('[seed] Seeding services...');

  const services = [
    {
      slug: 'residential-sales', order: 1,
      en: { title: 'Residential Sales', tagline: 'Expert guidance for buying and selling premium homes across Austin\'s most sought-after neighborhoods.', description: 'Our residential sales team combines deep local market knowledge with white-glove service to help you buy or sell with confidence. Whether you\'re upsizing, downsizing, or purchasing your first home, we handle every detail from listing to closing.', requirements: ['Valid government-issued ID','Mortgage pre-approval letter (buyers) or property deed (sellers)','Disclosure of any known property defects','Budget range and preferred neighborhoods'], processSteps: ['Initial consultation & needs assessment','Market analysis and property shortlisting','Property viewings and offer negotiation','Inspection, financing, and closing'] },
      ar: { title: 'المبيعات السكنية', tagline: 'إرشاد متخصص لشراء وبيع المنازل الراقية في أبرز أحياء أوستن.', description: 'يجمع فريق المبيعات السكنية لدينا المعرفة العميقة بالسوق المحلي مع الخدمة الراقية لمساعدتك في الشراء أو البيع بثقة تامة.', requirements: ['هوية حكومية سارية المفعول','خطاب موافقة مبدئية على التمويل (للمشترين) أو صك الملكية (للبائعين)','الإفصاح عن أي عيوب معروفة في العقار','النطاق الميزانية والأحياء المفضلة'], processSteps: ['استشارة أولية وتقييم الاحتياجات','تحليل السوق وإعداد قائمة مختصرة بالعقارات','معاينة العقارات والتفاوض على العروض','الفحص والتمويل والإغلاق'] },
    },
    {
      slug: 'investment-advisory', order: 2,
      en: { title: 'Investment Advisory', tagline: 'Strategic insights to maximize your real estate portfolio and identify high-value opportunities.', description: 'Our investment advisory team delivers institutional-grade analysis to individual and corporate investors. We identify undervalued assets, model returns, and structure acquisitions to maximize your long-term wealth.', requirements: ['Investment objectives and target ROI','Proof of funds or financing capacity','Risk tolerance and preferred asset classes','Investment timeline (short-term flip vs. long-term hold)'], processSteps: ['Portfolio review and investment goal setting','Market research and opportunity identification','Financial modeling and due diligence','Acquisition structuring and closing support'] },
      ar: { title: 'الاستشارات الاستثمارية', tagline: 'رؤى استراتيجية لتعظيم محفظتك العقارية وتحديد الفرص عالية القيمة.', description: 'يقدم فريق الاستشارات الاستثمارية لدينا تحليلات على مستوى المؤسسات للمستثمرين الأفراد والشركات.', requirements: ['أهداف الاستثمار والعائد المستهدف','إثبات الملاءة المالية أو القدرة التمويلية','مستوى تحمل المخاطر وفئات الأصول المفضلة','الأفق الزمني للاستثمار'], processSteps: ['مراجعة المحفظة وتحديد أهداف الاستثمار','أبحاث السوق وتحديد الفرص','النمذجة المالية والعناية الواجبة','هيكلة الاستحواذ ودعم الإغلاق'] },
    },
    {
      slug: 'commercial-leasing', order: 3,
      en: { title: 'Commercial Leasing', tagline: 'Full-service commercial real estate solutions for businesses of every size and ambition.', description: 'From boutique retail to corporate headquarters, our commercial leasing team negotiates lease terms that protect your business interests.', requirements: ['Business registration documents','Financial statements (last 2 years)','Space requirements: sq ft, layout, and term length','Target location and move-in timeline'], processSteps: ['Space needs analysis and market survey','Property tours and shortlisting','Lease negotiation and legal review','Space planning and move-in coordination'] },
      ar: { title: 'التأجير التجاري', tagline: 'حلول عقارية تجارية متكاملة للشركات بكل أحجامها وطموحاتها.', description: 'من المحلات التجارية الصغيرة إلى المقرات الرئيسية للشركات الكبرى، يتفاوض فريق التأجير التجاري لدينا على شروط إيجار تحمي مصالح عملك.', requirements: ['وثائق تسجيل الأعمال التجارية','البيانات المالية (آخر سنتين)','متطلبات المساحة: القدم المربع والتصميم ومدة العقد','الموقع المستهدف والجدول الزمني للانتقال'], processSteps: ['تحليل احتياجات المساحة ومسح السوق','جولات تفقد العقارات والقائمة المختصرة','التفاوض على الإيجار والمراجعة القانونية','تخطيط المساحة وتنسيق الانتقال'] },
    },
    {
      slug: 'relocation-services', order: 4,
      en: { title: 'Relocation Services', tagline: 'Seamless transitions for individuals and families moving to or within the Austin area.', description: 'Moving is stressful — we make it effortless. Our relocation specialists coordinate every aspect of your move, from neighborhood orientation and school research to home finding and utility setup.', requirements: ['Target move-in date and timeline flexibility','Household size and school-age children (if any)','Employment location and commute preferences','Budget range for rent or purchase'], processSteps: ['Relocation needs assessment','Neighborhood tours and lifestyle matching','Home search and lease/purchase coordination','Move-in support and community orientation'] },
      ar: { title: 'خدمات الانتقال', tagline: 'انتقالات سلسة للأفراد والعائلات القادمين إلى أوستن أو المنتقلين داخلها.', description: 'الانتقال مرهق — نجعله سهلاً وخالياً من المتاعب.', requirements: ['تاريخ الانتقال المستهدف ومرونة الجدول الزمني','حجم الأسرة والأطفال في سن الدراسة','موقع العمل وتفضيلات التنقل','النطاق الميزاني للإيجار أو الشراء'], processSteps: ['تقييم احتياجات الانتقال','جولات في الأحياء ومطابقة أسلوب الحياة','البحث عن المنزل وتنسيق الإيجار أو الشراء','دعم الانتقال والتعريف بالمجتمع'] },
    },
    {
      slug: 'property-management', order: 5,
      en: { title: 'Property Management', tagline: 'Hands-off ownership with hands-on management — protecting your investment around the clock.', description: 'Our property management team handles everything so you don\'t have to. From tenant screening and rent collection to maintenance coordination and financial reporting, we keep your asset performing at its best.', requirements: ['Property deed and ownership documentation','Existing lease agreements (if tenanted)','Insurance coverage details','Preferred communication and reporting frequency'], processSteps: ['Property inspection and condition report','Tenant screening and leasing','Ongoing maintenance and rent collection','Monthly financial reporting and annual review'] },
      ar: { title: 'إدارة العقارات', tagline: 'ملكية بدون عناء مع إدارة فعّالة — حماية استثمارك على مدار الساعة.', description: 'يتولى فريق إدارة العقارات لدينا كل شيء نيابة عنك.', requirements: ['صك الملكية ووثائق التملك','عقود الإيجار القائمة','تفاصيل التغطية التأمينية','التواصل المفضل وتكرار التقارير'], processSteps: ['فحص العقار وتقرير الحالة','فحص المستأجرين والتأجير','الصيانة المستمرة وتحصيل الإيجار','التقارير المالية الشهرية والمراجعة السنوية'] },
    },
    {
      slug: 'market-analysis', order: 6,
      en: { title: 'Market Analysis', tagline: 'Data-driven insights to help you buy, sell, or invest at exactly the right moment.', description: 'Our in-house market analysts produce comprehensive reports covering pricing trends, absorption rates, comparable sales, and demand forecasting.', requirements: ['Property address or target market area','Purpose of analysis (buy, sell, or invest)','Preferred report format (summary vs. detailed)','Timeline and urgency of decision'], processSteps: ['Data collection and market segmentation','Comparable analysis and trend modeling','Report preparation and review','Presentation and strategic recommendations'] },
      ar: { title: 'تحليل السوق', tagline: 'رؤى مبنية على البيانات لمساعدتك على الشراء أو البيع أو الاستثمار في التوقيت المثالي.', description: 'يُنتج محللو السوق الداخليون لدينا تقارير شاملة.', requirements: ['عنوان العقار أو منطقة السوق المستهدفة','الغرض من التحليل (شراء أو بيع أو استثمار)','صيغة التقرير المفضلة','الجدول الزمني وإلحاحية القرار'], processSteps: ['جمع البيانات وتقسيم السوق','التحليل المقارن ونمذجة الاتجاهات','إعداد التقرير ومراجعته','العرض والتوصيات الاستراتيجية'] },
    },
    {
      slug: 'interior-consulting', order: 7,
      en: { title: 'Interior Consulting', tagline: 'Transforming spaces to maximize appeal, value, and lifestyle — before listing or after purchase.', description: 'Our interior consultants work with buyers, sellers, and developers to enhance property value through thoughtful design.', requirements: ['Property photos or in-person walkthrough','Budget range for staging or renovation','Project timeline and listing date (if selling)','Style preferences and must-have features'], processSteps: ['Space assessment and consultation','Design concept and material selection','Staging or renovation coordination','Final walkthrough and photography'] },
      ar: { title: 'الاستشارات الداخلية', tagline: 'تحويل المساحات لتعظيم الجاذبية والقيمة وأسلوب الحياة.', description: 'يعمل مستشارو الديكور الداخلي لدينا مع المشترين والبائعين والمطورين.', requirements: ['صور العقار أو جولة ميدانية','النطاق الميزاني للإعداد أو التجديد','الجدول الزمني للمشروع وتاريخ الإدراج','تفضيلات الأسلوب والميزات الأساسية'], processSteps: ['تقييم المساحة والاستشارة','مفهوم التصميم واختيار المواد','تنسيق الإعداد أو التجديد','الجولة النهائية والتصوير'] },
    },
    {
      slug: 'legal-assistance', order: 8,
      en: { title: 'Legal Assistance', tagline: 'Expert legal support for every real estate transaction — protecting your interests from contract to closing.', description: 'Our affiliated legal team specializes in real estate law, covering purchase agreements, title searches, contract review, dispute resolution, and compliance.', requirements: ['Property address and transaction type','Existing contracts or documents for review','Parties involved in the transaction','Desired closing date and any known complications'], processSteps: ['Document review and legal assessment','Contract drafting or amendment','Title search and due diligence','Closing coordination and post-close support'] },
      ar: { title: 'المساعدة القانونية', tagline: 'دعم قانوني متخصص لكل معاملة عقارية — حماية مصالحك من العقد حتى الإغلاق.', description: 'يتخصص فريقنا القانوني المنتسب في قانون العقارات.', requirements: ['عنوان العقار ونوع المعاملة','العقود أو الوثائق الحالية للمراجعة','الأطراف المعنية بالمعاملة','تاريخ الإغلاق المطلوب وأي تعقيدات معروفة'], processSteps: ['مراجعة الوثائق والتقييم القانوني','صياغة العقد أو تعديله','البحث في السجلات والعناية الواجبة','تنسيق الإغلاق ودعم ما بعد الإغلاق'] },
    },
  ];

  for (const s of services) {
    await createWithLocale(
      strapi,
      'api::service.service',
      { title: s.en.title, slug: s.slug, tagline: s.en.tagline, description: s.en.description, requirements: s.en.requirements, processSteps: s.en.processSteps, order: s.order },
      { title: s.ar.title, slug: s.slug, tagline: s.ar.tagline, description: s.ar.description, requirements: s.ar.requirements, processSteps: s.ar.processSteps, order: s.order },
    );
  }

  strapi.log.info('[seed] Services seeded');
}

// ── Blog Posts ────────────────────────────────────────────────────────────────

async function seedBlogPosts(strapi: Core.Strapi) {
  const count = await countEntries(strapi, 'api::blog-post.blog-post');
  if (count > 0) return;

  strapi.log.info('[seed] Seeding blog posts...');

  const posts = [
    {
      slug: 'austin-real-estate-outlook-2025',
      date: '2025-05-01',
      image: 'showoff_section_image_1.jpg',
      en: { title: 'Austin\'s Real Estate Outlook for 2025', tag: 'Market Insights', excerpt: 'As Austin enters 2025, market fundamentals remain strong despite rising interest rates. Our analysts break down what buyers, sellers, and investors need to know.' },
      ar: { title: 'توقعات سوق العقارات في أوستن لعام 2025', tag: 'رؤى السوق', excerpt: 'مع دخول أوستن عام 2025، تظل الأساسيات السوقية قوية. يستعرض محللونا ما يحتاج المشترون والبائعون والمستثمرون معرفته.' },
    },
    {
      slug: 'domain-district-new-era-growth',
      date: '2025-04-01',
      image: 'showoff_section_image_2.jpg',
      en: { title: 'The Domain District: A New Era of Growth', tag: 'Development', excerpt: 'The Domain continues to redefine Austin\'s north corridor. With major tech campuses and luxury residential towers rising, here\'s why all eyes are on this district.' },
      ar: { title: 'حي ذا دومين: عصر جديد من النمو', tag: 'التطوير', excerpt: 'يواصل ذا دومين إعادة تعريف الممر الشمالي لأوستن. مع مقرات التكنولوجيا الكبرى وأبراج سكنية فاخرة ناهضة، إليك سبب تركيز الأنظار على هذا الحي.' },
    },
    {
      slug: 'smart-investors-targeting-east-austin',
      date: '2025-03-01',
      image: 'hero-card_1.jpg',
      en: { title: 'Why Smart Investors Are Targeting East Austin', tag: 'Investment', excerpt: 'East Austin has transformed from an up-and-coming neighborhood into one of the city\'s most sought-after markets. We explore the fundamentals driving this shift.' },
      ar: { title: 'لماذا يستهدف المستثمرون الأذكياء شرق أوستن', tag: 'الاستثمار', excerpt: 'تحول شرق أوستن من حي ناشئ إلى أحد أكثر الأسواق طلباً في المدينة. نستكشف الأساسيات التي تدفع هذا التحول.' },
    },
    {
      slug: 'amenities-define-luxury-2025',
      date: '2025-02-01',
      image: 'hero-card_2.jpg',
      en: { title: 'The Amenities That Define Luxury in 2025', tag: 'Design', excerpt: 'Today\'s luxury buyers expect more than marble countertops. From wellness centers to co-working suites, we examine the features commanding premium prices.' },
      ar: { title: 'المرافق التي تحدد الفخامة في 2025', tag: 'التصميم', excerpt: 'يتوقع مشترو الفخامة اليوم أكثر من أسطح الرخام. من مراكز العافية إلى مجموعات العمل المشترك، نفحص الميزات التي تفرض أسعاراً متميزة.' },
    },
    {
      slug: 'leed-certification-investment',
      date: '2025-01-01',
      image: 'hero-card_5.jpg',
      en: { title: 'LEED Certification: What It Means for Your Investment', tag: 'Sustainability', excerpt: 'Green building standards are no longer optional — they\'re a competitive advantage. Here\'s how LEED certification affects property values, tenant demand, and long-term ROI.' },
      ar: { title: 'شهادة LEED: ما تعنيه لاستثمارك', tag: 'الاستدامة', excerpt: 'معايير البناء الأخضر لم تعد اختيارية — إنها ميزة تنافسية. إليك كيف تؤثر شهادة LEED على قيم العقارات والطلب من المستأجرين والعائد على المدى الطويل.' },
    },
    {
      slug: 'rainey-street-austin-micro-neighborhood',
      date: '2024-12-01',
      image: 'hero-card_4.jpg',
      en: { title: 'Rainey Street: Austin\'s Most Vibrant Micro-Neighborhood', tag: 'Neighborhood', excerpt: 'Once a quiet residential block, Rainey Street has become Austin\'s most dynamic entertainment and living destination. We explore what makes this micro-neighborhood tick.' },
      ar: { title: 'راينى ستريت: أكثر أحياء أوستن الصغيرة حيوية', tag: 'الأحياء', excerpt: 'من بلوك سكني هادئ إلى أكثر وجهات الترفيه والمعيشة ديناميكية في أوستن. نستكشف ما يجعل هذا الحي الصغير يتحرك.' },
    },
  ];

  for (const p of posts) {
    const imageId = await getOrUploadMedia(strapi, p.image);

    await createWithLocale(
      strapi,
      'api::blog-post.blog-post',
      { title: p.en.title, slug: p.slug, tag: p.en.tag, date: p.date, excerpt: p.en.excerpt, body: `<p>${p.en.excerpt}</p>`, coverImage: imageId },
      { title: p.ar.title, slug: p.slug, tag: p.ar.tag, date: p.date, excerpt: p.ar.excerpt, body: `<p>${p.ar.excerpt}</p>`, coverImage: imageId },
    );
  }

  strapi.log.info('[seed] Blog posts seeded');
}

// ── Careers ───────────────────────────────────────────────────────────────────

async function seedCareers(strapi: Core.Strapi) {
  const count = await countEntries(strapi, 'api::career.career');
  if (count > 0) return;

  strapi.log.info('[seed] Seeding careers...');

  const careers = [
    {
      slug: 'senior-real-estate-agent',
      en: { title: 'Senior Real Estate Agent', location: 'Austin, TX', type: 'Full-Time', description: 'Lead residential and commercial transactions, develop client relationships, and mentor junior agents across our Austin portfolio.' },
      ar: { title: 'وكيل عقاري أول', location: 'أوستن، تكساس', type: 'دوام كامل', description: 'قيادة المعاملات السكنية والتجارية وتطوير علاقات العملاء وتوجيه الوكلاء الجدد في محفظتنا بأوستن.' },
    },
    {
      slug: 'investment-analyst',
      en: { title: 'Investment Analyst', location: 'Austin, TX', type: 'Full-Time', description: 'Conduct market research, financial modeling, and due diligence to identify high-value acquisition opportunities for our clients.' },
      ar: { title: 'محلل استثمار', location: 'أوستن، تكساس', type: 'دوام كامل', description: 'إجراء أبحاث السوق والنمذجة المالية والعناية الواجبة لتحديد فرص الاستحواذ عالية القيمة لعملائنا.' },
    },
    {
      slug: 'marketing-specialist',
      en: { title: 'Marketing Specialist', location: 'Austin, TX', type: 'Full-Time', description: 'Drive brand awareness and lead generation through digital campaigns, content creation, and property marketing strategies.' },
      ar: { title: 'متخصص تسويق', location: 'أوستن، تكساس', type: 'دوام كامل', description: 'تعزيز الوعي بالعلامة التجارية وتوليد العملاء المحتملين من خلال الحملات الرقمية وإنشاء المحتوى.' },
    },
    {
      slug: 'client-relations-manager',
      en: { title: 'Client Relations Manager', location: 'Austin, TX', type: 'Full-Time', description: 'Serve as the primary point of contact for our top-tier clients, ensuring an exceptional experience from first inquiry to closing.' },
      ar: { title: 'مدير علاقات العملاء', location: 'أوستن، تكساس', type: 'دوام كامل', description: 'العمل كنقطة الاتصال الأساسية لعملائنا المميزين وضمان تجربة استثنائية من أول استفسار حتى الإغلاق.' },
    },
    {
      slug: 'property-manager',
      en: { title: 'Property Manager', location: 'Austin, TX', type: 'Full-Time', description: 'Oversee day-to-day operations for our managed residential and commercial portfolio, coordinating maintenance and tenant relations.' },
      ar: { title: 'مدير عقارات', location: 'أوستن، تكساس', type: 'دوام كامل', description: 'الإشراف على العمليات اليومية لمحفظتنا السكنية والتجارية المُدارة وتنسيق الصيانة وعلاقات المستأجرين.' },
    },
    {
      slug: 'junior-real-estate-agent',
      en: { title: 'Junior Real Estate Agent', location: 'Austin, TX', type: 'Full-Time', description: 'An ideal entry point for newly licensed agents. Work alongside senior agents on active listings and client relationships.' },
      ar: { title: 'وكيل عقاري مبتدئ', location: 'أوستن، تكساس', type: 'دوام كامل', description: 'نقطة دخول مثالية للوكلاء المرخصين حديثاً. العمل جنباً إلى جنب مع الوكلاء الكبار في القوائم النشطة.' },
    },
  ];

  for (const c of careers) {
    await createWithLocale(
      strapi,
      'api::career.career',
      { title: c.en.title, slug: c.slug, location: c.en.location, type: c.en.type, description: c.en.description, isOpen: true },
      { title: c.ar.title, slug: c.slug, location: c.ar.location, type: c.ar.type, description: c.ar.description, isOpen: true },
    );
  }

  strapi.log.info('[seed] Careers seeded');
}

// ── Homepage ──────────────────────────────────────────────────────────────────

async function seedHomepage(strapi: Core.Strapi) {
  const count = await countEntries(strapi, 'api::homepage.homepage');
  if (count > 0) return;

  strapi.log.info('[seed] Seeding homepage...');

  const heroImageId = await getOrUploadMedia(strapi, 'hero.jpg');
  const visionImageId = await getOrUploadMedia(strapi, 'vision&message_image.jpg');
  const galleryImageIds: number[] = [];
  for (const img of ['hero-card_1.jpg','hero-card_2.jpg','hero-card_3.jpg','hero-card_4.jpg','hero-card_5.jpg']) {
    const id = await getOrUploadMedia(strapi, img);
    if (id) galleryImageIds.push(id);
  }

  await createSingleTypeWithLocale(
    strapi,
    'api::homepage.homepage',
    {
      heroHeadline1: 'Elevating',
      heroHeadline2: 'Real Estate',
      heroHeadline3: 'Excellence',
      heroCta: 'Explore Properties',
      heroPhone: '+1 (512) 000-0000',
      whoWeAreEyebrow: 'Who We Are',
      whoWeAreHeading: 'Austin\'s Premier Real Estate Partner',
      whoWeAreStat1Value: '500+',
      whoWeAreStat1Label: 'Projects Completed',
      whoWeAreStat2Value: '12',
      whoWeAreStat2Label: 'Industry Awards',
      whoWeAreStat3Value: '4.9',
      whoWeAreStat3Label: 'Client Rating',
      visionLabel: 'Our Vision',
      visionText: 'To redefine the standard of real estate by delivering exceptional properties that inspire and endure — building communities where people truly belong.',
      messageLabel: 'Our Message',
      messageText: 'At Nexus Properties, every transaction is built on trust, transparency, and an unwavering commitment to excellence. We don\'t just sell properties — we craft lasting legacies.',
      sophisticationHeading: 'Where sophistication meets substance — every detail thoughtfully considered.',
      sophisticationSub: 'From concept to completion, Nexus Properties delivers residences that transcend the ordinary and define a new standard of living.',
      heroImages: heroImageId ? [heroImageId] : [],
      galleryImages: galleryImageIds,
      visionImage: visionImageId,
    },
    {
      heroHeadline1: 'الارتقـــــــــــــــاء',
      heroHeadline2: 'بالعقـــــــــــــــــــــــــــــــارات',
      heroHeadline3: 'نحو التميـــــــــز',
      heroCta: 'استكشف العقارات',
      whoWeAreEyebrow: 'من نحن',
      whoWeAreHeading: 'الشريك العقاري الأول في أوستن',
      whoWeAreStat1Value: '+500',
      whoWeAreStat1Label: 'مشروع منجز',
      whoWeAreStat2Value: '12',
      whoWeAreStat2Label: 'جائزة صناعية',
      whoWeAreStat3Value: '4.9',
      whoWeAreStat3Label: 'تقييم العملاء',
      visionLabel: 'رؤيتنا',
      visionText: 'إعادة تعريف معايير العقارات من خلال تقديم عقارات استثنائية تُلهم وتدوم — بناء مجتمعات يشعر فيها الناس بالانتماء الحقيقي.',
      messageLabel: 'رسالتنا',
      messageText: 'في نكسس للعقارات، تُبنى كل صفقة على الثقة والشفافية والالتزام الراسخ بالتميز. نحن لا نبيع عقارات فحسب — بل نصنع إرثاً دائماً.',
      sophisticationHeading: 'حيث يلتقي الرقي بالجوهر — كل تفصيل مدروس بعناية.',
      sophisticationSub: 'من الفكرة إلى الإنجاز، تُقدم نكسس للعقارات مساكن تتجاوز المألوف وترسم معياراً جديداً للحياة الراقية.',
    },
  );

  strapi.log.info('[seed] Homepage seeded');
}

// ── Site Settings ─────────────────────────────────────────────────────────────

async function seedSiteSettings(strapi: Core.Strapi) {
  const count = await countEntries(strapi, 'api::site-setting.site-setting');
  if (count > 0) return;

  strapi.log.info('[seed] Seeding site settings...');

  await createSingleTypeWithLocale(
    strapi,
    'api::site-setting.site-setting',
    {
      companyName: 'Nexus Properties',
      tagline: 'Elevating Real Estate Excellence',
      address: '1234 Lamar Blvd, Austin, TX 78704',
      phone: '+1 (512) 000-0000',
      email: 'hello@nexusproperties.com',
      hours1: 'Mon – Thu: 9am – 6pm',
      hours2: 'Friday: 9am – 5pm',
      hours3: 'Saturday: 10am – 4pm',
      hours4: 'Sunday: Closed',
      instagramUrl: 'https://instagram.com/nexuspropertiesatx',
      facebookUrl: 'https://facebook.com/NexusPropertiesAustin',
      youtubeUrl: 'https://youtube.com/@NexusPropertiesAustin',
      linkedinUrl: 'https://linkedin.com/company/nexus-properties',
      tiktokUrl: 'https://tiktok.com/@nexusatx',
      copyright: '© 2025 Nexus Properties. All rights reserved.',
      copyrightSub: 'Licensed Real Estate Brokerage · Austin, Texas',
    },
    {
      companyName: 'Nexus Properties',
      tagline: 'الارتقاء بالتميز العقاري',
      address: '1234 لامار بوليفارد، أوستن، تكساس 78704',
      phone: '+1 (512) 000-0000',
      email: 'hello@nexusproperties.com',
      hours1: 'الإثنين – الخميس: 9ص – 6م',
      hours2: 'الجمعة: 9ص – 5م',
      hours3: 'السبت: 10ص – 4م',
      hours4: 'الأحد: مغلق',
      instagramUrl: 'https://instagram.com/nexuspropertiesatx',
      facebookUrl: 'https://facebook.com/NexusPropertiesAustin',
      youtubeUrl: 'https://youtube.com/@NexusPropertiesAustin',
      linkedinUrl: 'https://linkedin.com/company/nexus-properties',
      tiktokUrl: 'https://tiktok.com/@nexusatx',
      copyright: '© 2025 نكسس للعقارات. جميع الحقوق محفوظة.',
      copyrightSub: 'وساطة عقارية مرخصة · أوستن، تكساس',
    },
  );

  strapi.log.info('[seed] Site settings seeded');
}

// ── Legal Pages ───────────────────────────────────────────────────────────────

async function seedLegalPages(strapi: Core.Strapi) {
  const legalData = [
    {
      uid: 'api::privacy-policy.privacy-policy',
      en: {
        heading: 'Privacy Policy',
        lastUpdated: 'Last updated: June 2025',
        sections: [
          { heading: 'Information We Collect', body: 'We collect information you provide directly to us, such as when you inquire about a property, register for events, or contact us for services. This includes your name, email address, phone number, and any other details you share.' },
          { heading: 'How We Use Your Information', body: 'We use the information we collect to provide, maintain, and improve our services, communicate with you about properties and opportunities, send you market reports and newsletters you\'ve requested, and comply with legal obligations.' },
          { heading: 'Information Sharing', body: 'We do not sell your personal information. We may share your information with trusted service providers who assist us in operating our business, subject to confidentiality agreements.' },
          { heading: 'Data Security', body: 'We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.' },
          { heading: 'Contact Us', body: 'If you have questions about this Privacy Policy or our data practices, please contact us at hello@nexusproperties.com or visit our office at 1234 Lamar Blvd, Austin, TX 78704.' },
        ],
      },
      ar: {
        heading: 'سياسة الخصوصية',
        lastUpdated: 'آخر تحديث: يونيو 2025',
        sections: [
          { heading: 'المعلومات التي نجمعها', body: 'نجمع المعلومات التي تقدمها لنا مباشرةً، مثل عند الاستفسار عن عقار أو التسجيل في الفعاليات أو التواصل معنا للحصول على الخدمات.' },
          { heading: 'كيف نستخدم معلوماتك', body: 'نستخدم المعلومات التي نجمعها لتقديم خدماتنا وصيانتها وتحسينها، والتواصل معك بشأن العقارات والفرص.' },
          { heading: 'مشاركة المعلومات', body: 'لا نبيع معلوماتك الشخصية. قد نشارك معلوماتك مع مزودي الخدمات الموثوقين وفق اتفاقيات سرية.' },
          { heading: 'أمان البيانات', body: 'نطبق تدابير تقنية وتنظيمية مناسبة لحماية معلوماتك الشخصية من الوصول غير المصرح به.' },
          { heading: 'تواصل معنا', body: 'إذا كانت لديك أسئلة حول سياسة الخصوصية هذه، يرجى التواصل معنا على hello@nexusproperties.com.' },
        ],
      },
    },
    {
      uid: 'api::terms-of-service.terms-of-service',
      en: {
        heading: 'Terms of Service',
        lastUpdated: 'Last updated: June 2025',
        sections: [
          { heading: 'Acceptance of Terms', body: 'By accessing or using the Nexus Properties website and services, you agree to be bound by these Terms of Service.' },
          { heading: 'Use of Services', body: 'Our services are intended for lawful purposes only. You agree not to misuse our platform, reproduce content without permission, or engage in any activity that could harm Nexus Properties or its clients.' },
          { heading: 'Intellectual Property', body: 'All content on this website, including text, images, logos, and designs, is the intellectual property of Nexus Properties or its licensors. Unauthorized use is strictly prohibited.' },
          { heading: 'Disclaimer of Warranties', body: 'Our services are provided \'as is\' without warranties of any kind. We do not guarantee the accuracy of property listings, market data, or investment projections.' },
          { heading: 'Limitation of Liability', body: 'Nexus Properties shall not be liable for any indirect, incidental, or consequential damages arising from your use of our services.' },
        ],
      },
      ar: {
        heading: 'شروط الخدمة',
        lastUpdated: 'آخر تحديث: يونيو 2025',
        sections: [
          { heading: 'قبول الشروط', body: 'بالوصول إلى موقع نكسس للعقارات أو استخدام خدماتنا، فإنك توافق على الالتزام بشروط الخدمة هذه.' },
          { heading: 'استخدام الخدمات', body: 'خدماتنا مخصصة للأغراض المشروعة فقط. توافق على عدم إساءة استخدام منصتنا.' },
          { heading: 'الملكية الفكرية', body: 'جميع المحتويات على هذا الموقع هي ملكية فكرية لنكسس للعقارات أو المرخصين لها.' },
          { heading: 'إخلاء المسؤولية عن الضمانات', body: 'تُقدَّم خدماتنا "كما هي" دون أي ضمانات من أي نوع.' },
          { heading: 'تحديد المسؤولية', body: 'لن تكون نكسس للعقارات مسؤولة عن أي أضرار غير مباشرة أو عرضية أو تبعية.' },
        ],
      },
    },
    {
      uid: 'api::cookie-policy.cookie-policy',
      en: {
        heading: 'Cookie Policy',
        lastUpdated: 'Last updated: June 2025',
        sections: [
          { heading: 'What Are Cookies', body: 'Cookies are small text files placed on your device when you visit our website. They help us provide a better experience by remembering your preferences.' },
          { heading: 'Types of Cookies We Use', body: 'We use essential cookies (required for the website to function), analytics cookies (to understand traffic patterns), and preference cookies (to remember your language and display choices).' },
          { heading: 'Managing Cookies', body: 'You can control cookies through your browser settings. Disabling cookies may affect some functionality of our website.' },
          { heading: 'Contact', body: 'For questions about our cookie practices, contact us at hello@nexusproperties.com.' },
        ],
      },
      ar: {
        heading: 'سياسة ملفات تعريف الارتباط',
        lastUpdated: 'آخر تحديث: يونيو 2025',
        sections: [
          { heading: 'ما هي ملفات تعريف الارتباط', body: 'ملفات تعريف الارتباط هي ملفات نصية صغيرة توضع على جهازك عند زيارة موقعنا.' },
          { heading: 'أنواع ملفات تعريف الارتباط التي نستخدمها', body: 'نستخدم ملفات تعريف الارتباط الأساسية وملفات التحليل وملفات التفضيلات.' },
          { heading: 'إدارة ملفات تعريف الارتباط', body: 'يمكنك التحكم في ملفات تعريف الارتباط من خلال إعدادات المتصفح.' },
          { heading: 'التواصل', body: 'لأي أسئلة، تواصل معنا على hello@nexusproperties.com.' },
        ],
      },
    },
    {
      uid: 'api::disclaimer.disclaimer',
      en: {
        heading: 'Disclaimer',
        lastUpdated: 'Last updated: June 2025',
        sections: [
          { heading: 'General Information Only', body: 'The information on this website is provided for general informational purposes only and does not constitute professional real estate, financial, legal, or investment advice.' },
          { heading: 'Property Information Accuracy', body: 'While we strive to keep property listings, pricing, and availability accurate, information is subject to change without notice.' },
          { heading: 'Third-Party Links', body: 'Our website may contain links to third-party websites. Nexus Properties is not responsible for the content, privacy practices, or reliability of any external sites.' },
        ],
      },
      ar: {
        heading: 'إخلاء المسؤولية',
        lastUpdated: 'آخر تحديث: يونيو 2025',
        sections: [
          { heading: 'معلومات عامة فقط', body: 'المعلومات الواردة في هذا الموقع مقدمة لأغراض إعلامية عامة فقط ولا تشكل نصيحة عقارية أو مالية أو قانونية.' },
          { heading: 'دقة معلومات العقارات', body: 'بينما نسعى إلى الحفاظ على دقة قوائم العقارات والأسعار وتوافرها، قد تتغير المعلومات دون إشعار.' },
          { heading: 'روابط الطرف الثالث', body: 'قد يحتوي موقعنا على روابط لمواقع طرف ثالث. لا تتحمل نكسس للعقارات المسؤولية عن محتوى أي مواقع خارجية.' },
        ],
      },
    },
    {
      uid: 'api::accessibility-statement.accessibility-statement',
      en: {
        heading: 'Accessibility Statement',
        lastUpdated: 'Last updated: June 2025',
        sections: [
          { heading: 'Our Commitment', body: 'Nexus Properties is committed to ensuring digital accessibility for people with disabilities. We continually improve the user experience for everyone and apply relevant accessibility standards.' },
          { heading: 'Conformance Status', body: 'We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA. Our website is built with semantic HTML, sufficient color contrast, keyboard navigability, and screen reader compatibility.' },
          { heading: 'Feedback & Contact', body: 'If you experience any accessibility barriers or have suggestions for improvement, please contact us at hello@nexusproperties.com. We take all feedback seriously and respond within 2 business days.' },
        ],
      },
      ar: {
        heading: 'بيان إمكانية الوصول',
        lastUpdated: 'آخر تحديث: يونيو 2025',
        sections: [
          { heading: 'التزامنا', body: 'تلتزم نكسس للعقارات بضمان إمكانية الوصول الرقمي للأشخاص ذوي الإعاقات.' },
          { heading: 'حالة المطابقة', body: 'نسعى للامتثال لإرشادات إمكانية الوصول إلى محتوى الويب (WCAG) 2.1 المستوى AA.' },
          { heading: 'الملاحظات والتواصل', body: 'إذا واجهت أي عوائق في إمكانية الوصول، يرجى التواصل معنا على hello@nexusproperties.com.' },
        ],
      },
    },
  ];

  for (const page of legalData) {
    await createSingleTypeWithLocale(strapi, page.uid, page.en, page.ar);
  }

  strapi.log.info('[seed] Legal pages seeded');
}
