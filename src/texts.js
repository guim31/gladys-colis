// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface (German says "du", Spanish "usted"). An integration of type device
// does not receive the user's language: the `language` of the configuration
// decides, except for the widget, which receives it. Brands (17TRACK, DHL) are
// never translated, and the text of the carriers is shown as they send it.
// test/i18n.test.js checks that every table has the four languages and the
// same keys.
// -----------------------------------------------------------------------------

/** The entry of `table` for `language`, English when unknown. */
export const pick = (table, language) => table[language] ?? table.en;

// Feature names of a parcel device, frozen at creation in Gladys.
export const NAMES = {
  en: {
    status: 'Status',
    event: 'Last event',
    location: 'Place',
    event_date: 'Event date',
    carrier: 'Carrier',
    eta: 'Expected delivery',
  },
  fr: {
    status: 'Statut',
    event: 'Dernière étape',
    location: 'Lieu',
    event_date: "Date de l'étape",
    carrier: 'Transporteur',
    eta: 'Livraison prévue',
  },
  de: {
    status: 'Status',
    event: 'Letzter Schritt',
    location: 'Ort',
    event_date: 'Datum des Schritts',
    carrier: 'Zusteller',
    eta: 'Voraussichtliche Zustellung',
  },
  es: {
    status: 'Estado',
    event: 'Último paso',
    location: 'Lugar',
    event_date: 'Fecha del paso',
    carrier: 'Transportista',
    eta: 'Entrega prevista',
  },
};

// Short status labels: widget badges and the status feature (16 characters
// at most).
export const STATUS_LABELS = {
  en: {
    pending: 'Not read yet',
    not_found: 'Not found yet',
    info_received: 'Registered',
    in_transit: 'In transit',
    out_for_delivery: 'Out for delivery',
    awaiting_pickup: 'To pick up',
    problem: 'Problem',
    delivered: 'Delivered',
  },
  fr: {
    pending: 'Pas encore lu',
    not_found: 'Pas encore connu',
    info_received: 'Enregistré',
    in_transit: 'En transit',
    out_for_delivery: 'En livraison',
    awaiting_pickup: 'À retirer',
    problem: 'Problème',
    delivered: 'Livré',
  },
  de: {
    pending: 'Nicht gelesen',
    not_found: 'Noch unbekannt',
    info_received: 'Angekündigt',
    in_transit: 'Unterwegs',
    out_for_delivery: 'In Zustellung',
    awaiting_pickup: 'Abholbereit',
    problem: 'Problem',
    delivered: 'Zugestellt',
  },
  es: {
    pending: 'Sin leer',
    not_found: 'Aún desconocido',
    info_received: 'Registrado',
    in_transit: 'En tránsito',
    out_for_delivery: 'En reparto',
    awaiting_pickup: 'Para recoger',
    problem: 'Problema',
    delivered: 'Entregado',
  },
};

// The status inside a sentence: "Shoes, out for delivery today".
export const PHRASES = {
  en: {
    pending: 'not read yet',
    not_found: 'not known to the carriers yet',
    info_received: 'announced by the sender',
    in_transit: 'in transit',
    out_for_delivery: 'out for delivery today',
    awaiting_pickup: 'waiting to be picked up',
    problem: 'held up by a problem',
    delivered: 'delivered',
  },
  fr: {
    pending: 'pas encore lu',
    not_found: 'pas encore connu des transporteurs',
    info_received: "annoncé par l'expéditeur",
    in_transit: 'en transit',
    out_for_delivery: "en cours de livraison aujourd'hui",
    awaiting_pickup: 'à retirer',
    problem: 'bloqué par un problème',
    delivered: 'livré',
  },
  de: {
    pending: 'noch nicht gelesen',
    not_found: 'den Zustellern noch unbekannt',
    info_received: 'vom Absender angekündigt',
    in_transit: 'unterwegs',
    out_for_delivery: 'heute in Zustellung',
    awaiting_pickup: 'abholbereit',
    problem: 'durch ein Problem aufgehalten',
    delivered: 'zugestellt',
  },
  es: {
    pending: 'aún sin leer',
    not_found: 'aún desconocido para los transportistas',
    info_received: 'anunciado por el remitente',
    in_transit: 'en tránsito',
    out_for_delivery: 'en reparto hoy',
    awaiting_pickup: 'esperando su recogida',
    problem: 'retenido por un problema',
    delivered: 'entregado',
  },
};

// "You have 2 parcels on the way: Shoes, out for delivery today; Book, in transit."
export const SENTENCES = {
  en: {
    none: 'No parcel on the way.',
    intro: ({ count }) =>
      count === 1 ? 'You have 1 parcel on the way: ' : `You have ${count} parcels on the way: `,
    item: ({ name, phrase }) => `${name}, ${phrase}`,
    separator: '; ',
    end: '.',
  },
  fr: {
    none: 'Aucun colis en cours.',
    intro: ({ count }) => `Vous avez ${count} colis en cours : `,
    item: ({ name, phrase }) => `${name}, ${phrase}`,
    separator: ' ; ',
    end: '.',
  },
  de: {
    none: 'Keine Sendung unterwegs.',
    intro: ({ count }) =>
      count === 1 ? 'Du hast 1 Sendung unterwegs: ' : `Du hast ${count} Sendungen unterwegs: `,
    item: ({ name, phrase }) => `${name}, ${phrase}`,
    separator: '; ',
    end: '.',
  },
  es: {
    none: 'Ningún paquete en curso.',
    intro: ({ count }) =>
      count === 1 ? 'Tiene 1 paquete en curso: ' : `Tiene ${count} paquetes en curso: `,
    item: ({ name, phrase }) => `${name}, ${phrase}`,
    separator: '; ',
    end: '.',
  },
};

// Connection badge of the Configuration screen.
export const CONNECTION = {
  noKey: {
    en: 'Enter a 17TRACK key, a DHL key, or both, to read your parcels.',
    fr: 'Saisissez une clé 17TRACK, une clé DHL, ou les deux, pour lire vos colis.',
    de: 'Gib einen 17TRACK-Schlüssel, einen DHL-Schlüssel oder beide ein, um deine Sendungen zu lesen.',
    es: 'Introduzca una clave de 17TRACK, una de DHL o ambas para leer sus paquetes.',
  },
  keysRefused: {
    en: 'The API keys are refused: check them in the configuration.',
    fr: 'Les clés d’API sont refusées : vérifiez-les dans la configuration.',
    de: 'Die API-Schlüssel werden abgelehnt: Prüfe sie in der Konfiguration.',
    es: 'Las claves de API son rechazadas: compruébelas en la configuración.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Logs der Integration nach.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

// What keeps a source from being read (widget caption, action answers).
export const ERRORS = {
  en: {
    invalid_key: ({ source }) => `${source} refuses the API key: check it in the configuration.`,
    quota: ({ source }) => `${source} quota reached: readings paused for a while.`,
    unavailable: ({ source }) => `${source} does not answer: readings paused for a while.`,
    budget: ({ source }) => `${source} daily allowance used: readings resume tomorrow.`,
  },
  fr: {
    invalid_key: ({ source }) =>
      `${source} refuse la clé d'API : vérifiez-la dans la configuration.`,
    quota: ({ source }) => `Quota ${source} atteint : lectures en pause pour un moment.`,
    unavailable: ({ source }) => `${source} ne répond pas : lectures en pause pour un moment.`,
    budget: ({ source }) => `Lectures ${source} du jour épuisées : elles reprennent demain.`,
  },
  de: {
    invalid_key: ({ source }) =>
      `${source} lehnt den API-Schlüssel ab: Prüfe ihn in der Konfiguration.`,
    quota: ({ source }) => `${source}-Kontingent erreicht: Abfragen eine Weile pausiert.`,
    unavailable: ({ source }) => `${source} antwortet nicht: Abfragen eine Weile pausiert.`,
    budget: ({ source }) => `${source}-Abfragen für heute aufgebraucht: Weiter geht es morgen.`,
  },
  es: {
    invalid_key: ({ source }) =>
      `${source} rechaza la clave de API: compruébela en la configuración.`,
    quota: ({ source }) => `Cuota de ${source} alcanzada: lecturas en pausa durante un tiempo.`,
    unavailable: ({ source }) => `${source} no responde: lecturas en pausa durante un tiempo.`,
    budget: ({ source }) => `Lecturas de ${source} agotadas por hoy: se reanudan mañana.`,
  },
};

// Answers of the configuration actions.
export const MESSAGES = {
  en: {
    invalidNumber: ({ value }) =>
      `"${value}" is not a tracking number (8 to 40 letters and digits, 5 digits at least).`,
    tooMany: ({ max }) => `${max} parcels are tracked already: remove one first.`,
    added: ({ name, status }) => `${name} is tracked. Status: ${status}.`,
    addedCreate: 'Create its device in the Discover tab to see it in Gladys.',
    renamed: ({ name }) => `Parcel renamed ${name}.`,
    notTracked: ({ value }) => `No tracked parcel has the name or number "${value}".`,
    removed: ({ name }) => `${name} is no longer tracked. You can delete its device in Gladys.`,
    noKey: 'No API key yet: the parcel will be read once you enter one.',
    noSource:
      'No source can read this number: enter a 17TRACK key (every carrier) in the configuration.',
    nothingToRefresh: 'No parcel on the way: the keys answer.',
    refreshed: ({ count }) => `${count} parcel(s) read.`,
    quota: ({ remaining, total }) => `17TRACK: ${remaining} registrations left of ${total}.`,
    dhlUsage: ({ used, max }) => `DHL: ${used} of ${max} requests used today.`,
  },
  fr: {
    invalidNumber: ({ value }) =>
      `« ${value} » n'est pas un numéro de suivi (8 à 40 lettres et chiffres, dont 5 chiffres au moins).`,
    tooMany: ({ max }) => `${max} colis sont déjà suivis : retirez-en un d'abord.`,
    added: ({ name, status }) => `${name} est suivi. Statut : ${status}.`,
    addedCreate: "Créez son appareil dans l'onglet Découverte pour le voir dans Gladys.",
    renamed: ({ name }) => `Colis renommé ${name}.`,
    notTracked: ({ value }) => `Aucun colis suivi ne porte le nom ou le numéro « ${value} ».`,
    removed: ({ name }) =>
      `${name} n'est plus suivi. Vous pouvez supprimer son appareil dans Gladys.`,
    noKey: "Pas encore de clé d'API : le colis sera lu dès que vous en saisirez une.",
    noSource:
      'Aucune source ne sait lire ce numéro : saisissez une clé 17TRACK (tous transporteurs) dans la configuration.',
    nothingToRefresh: 'Aucun colis en cours : les clés répondent.',
    refreshed: ({ count }) => `${count} colis lu(s).`,
    quota: ({ remaining, total }) =>
      `17TRACK : ${remaining} enregistrements restants sur ${total}.`,
    dhlUsage: ({ used, max }) => `DHL : ${used} requêtes sur ${max} utilisées aujourd'hui.`,
  },
  de: {
    invalidNumber: ({ value }) =>
      `„${value}“ ist keine Sendungsnummer (8 bis 40 Buchstaben und Ziffern, mindestens 5 Ziffern).`,
    tooMany: ({ max }) => `Es werden schon ${max} Sendungen verfolgt: Entferne zuerst eine.`,
    added: ({ name, status }) => `${name} wird verfolgt. Status: ${status}.`,
    addedCreate: 'Lege ihr Gerät im Tab „Entdecken“ an, um sie in Gladys zu sehen.',
    renamed: ({ name }) => `Sendung in ${name} umbenannt.`,
    notTracked: ({ value }) => `Keine verfolgte Sendung hat den Namen oder die Nummer „${value}“.`,
    removed: ({ name }) =>
      `${name} wird nicht mehr verfolgt. Du kannst ihr Gerät in Gladys löschen.`,
    noKey: 'Noch kein API-Schlüssel: Die Sendung wird gelesen, sobald du einen eingibst.',
    noSource:
      'Keine Quelle kann diese Nummer lesen: Gib in der Konfiguration einen 17TRACK-Schlüssel (alle Zusteller) ein.',
    nothingToRefresh: 'Keine Sendung unterwegs: Die Schlüssel antworten.',
    refreshed: ({ count }) => `${count} Sendung(en) gelesen.`,
    quota: ({ remaining, total }) =>
      `17TRACK: noch ${remaining} von ${total} Registrierungen übrig.`,
    dhlUsage: ({ used, max }) => `DHL: heute ${used} von ${max} Abfragen verbraucht.`,
  },
  es: {
    invalidNumber: ({ value }) =>
      `«${value}» no es un número de seguimiento (de 8 a 40 letras y cifras, al menos 5 cifras).`,
    tooMany: ({ max }) => `Ya se siguen ${max} paquetes: quite uno primero.`,
    added: ({ name, status }) => `${name} está en seguimiento. Estado: ${status}.`,
    addedCreate: 'Cree su dispositivo en la pestaña Descubrir para verlo en Gladys.',
    renamed: ({ name }) => `Paquete renombrado ${name}.`,
    notTracked: ({ value }) =>
      `Ningún paquete en seguimiento tiene el nombre o el número «${value}».`,
    removed: ({ name }) =>
      `${name} ya no está en seguimiento. Puede eliminar su dispositivo en Gladys.`,
    noKey: 'Aún no hay clave de API: el paquete se leerá en cuanto introduzca una.',
    noSource:
      'Ninguna fuente puede leer este número: introduzca una clave de 17TRACK (todos los transportistas) en la configuración.',
    nothingToRefresh: 'Ningún paquete en curso: las claves responden.',
    refreshed: ({ count }) => `${count} paquete(s) leído(s).`,
    quota: ({ remaining, total }) => `17TRACK: quedan ${remaining} registros de ${total}.`,
    dhlUsage: ({ used, max }) => `DHL: ${used} de ${max} consultas usadas hoy.`,
  },
};

// Texts of the widget, in the language the widget receives.
export const WIDGET_TEXT = {
  number: { en: 'No.', fr: 'N°', de: 'Nr.', es: 'N.º' },
  expected: { en: 'Expected', fr: 'Prévu le', de: 'Erwartet', es: 'Previsto' },
  delivered_on: { en: 'Delivered', fr: 'Livré le', de: 'Zugestellt', es: 'Entregado' },
  history: { en: 'History', fr: 'Historique', de: 'Verlauf', es: 'Historial' },
  link: { en: 'Tracking page', fr: 'Page de suivi', de: 'Verfolgungsseite', es: 'Seguimiento' },
  empty: {
    en: 'No parcel tracked. Add one with the "Track a parcel" action of the configuration or of a scene.',
    fr: "Aucun colis suivi. Ajoutez-en un avec l'action « Suivre un colis » de la configuration ou d'une scène.",
    de: 'Keine Sendung verfolgt. Füge eine mit der Aktion „Sendung verfolgen“ der Konfiguration oder einer Szene hinzu.',
    es: 'Ningún paquete en seguimiento. Añada uno con la acción «Seguir un paquete» de la configuración o de una escena.',
  },
  more: {
    en: '+ {count} more parcels',
    fr: '+ {count} autres colis',
    de: '+ {count} weitere',
    es: '+ {count} paquetes más',
  },
};
