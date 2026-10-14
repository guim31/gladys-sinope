// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (choice of the maintainer for
// all his integrations). The feature names follow the `language` setting; the
// widget texts follow the language of the dashboard viewer. Sinopé, Neviweb and
// Éco-Sinopé are brands: never translated.
// -----------------------------------------------------------------------------

/** Feature names, by language then feature key. Frozen once a device is created. */
export const NAMES = {
  en: {
    temperature: 'Temperature',
    setpoint: 'Setpoint',
    mode: 'Mode',
    preset: 'Preset',
    operating_state: 'Heating state',
    heating: 'Heating power',
    energy: 'Consumption',
    light: 'Light',
    brightness: 'Brightness',
    switch: 'On/off',
    power: 'Power',
    water_temperature: 'Water temperature',
    leak: 'Water leak',
    battery: 'Battery',
    online: 'Online',
  },
  fr: {
    temperature: 'Température',
    setpoint: 'Consigne',
    mode: 'Mode',
    preset: 'Préréglage',
    operating_state: 'État de chauffe',
    heating: 'Puissance de chauffe',
    energy: 'Consommation',
    light: 'Lumière',
    brightness: 'Intensité',
    switch: 'Marche/arrêt',
    power: 'Puissance',
    water_temperature: "Température de l'eau",
    leak: "Fuite d'eau",
    battery: 'Batterie',
    online: 'En ligne',
  },
  de: {
    temperature: 'Temperatur',
    setpoint: 'Solltemperatur',
    mode: 'Modus',
    preset: 'Voreinstellung',
    operating_state: 'Heizzustand',
    heating: 'Heizleistung',
    energy: 'Verbrauch',
    light: 'Licht',
    brightness: 'Helligkeit',
    switch: 'Ein/Aus',
    power: 'Leistung',
    water_temperature: 'Wassertemperatur',
    leak: 'Wasserleck',
    battery: 'Batterie',
    online: 'Online',
  },
  es: {
    temperature: 'Temperatura',
    setpoint: 'Consigna',
    mode: 'Modo',
    preset: 'Preajuste',
    operating_state: 'Estado de calefacción',
    heating: 'Potencia de calefacción',
    energy: 'Consumo',
    light: 'Luz',
    brightness: 'Brillo',
    switch: 'Encendido/apagado',
    power: 'Potencia',
    water_temperature: 'Temperatura del agua',
    leak: 'Fuga de agua',
    battery: 'Batería',
    online: 'En línea',
  },
};

/** Short texts: connection statuses, widget labels and buttons. */
export const TEXT = {
  notConfigured: {
    en: 'Enter the e-mail and password of your Neviweb account',
    fr: 'Saisissez le courriel et le mot de passe de votre compte Neviweb',
    de: 'Gib die E-Mail-Adresse und das Passwort deines Neviweb-Kontos ein',
    es: 'Introduzca el correo electrónico y la contraseña de su cuenta Neviweb',
  },
  badLogin: {
    en: 'Neviweb refused this e-mail and password: correct them, then save',
    fr: 'Neviweb refuse ce courriel et ce mot de passe : corrigez-les, puis enregistrez',
    de: 'Neviweb lehnt diese E-Mail-Adresse und dieses Passwort ab: korrigiere sie und speichere',
    es: 'Neviweb rechaza este correo y esta contraseña: corríjalos y guarde',
  },
  tooManySessions: {
    en: 'Neviweb refuses the login for now (too many sessions or logins): new try in 15 minutes',
    fr: 'Neviweb refuse la connexion pour l’instant (trop de sessions ou de connexions) : nouvel essai dans 15 minutes',
    de: 'Neviweb lehnt die Anmeldung gerade ab (zu viele Sitzungen oder Anmeldungen): neuer Versuch in 15 Minuten',
    es: 'Neviweb rechaza la conexión por ahora (demasiadas sesiones o conexiones): nuevo intento en 15 minutos',
  },
  dailyLimit: {
    en: 'Daily Neviweb request budget reached: readings resume at midnight',
    fr: 'Budget quotidien de requêtes Neviweb atteint : les lectures reprennent à minuit',
    de: 'Tägliches Neviweb-Anfragebudget erreicht: die Abfragen laufen um Mitternacht weiter',
    es: 'Presupuesto diario de solicitudes Neviweb alcanzado: las lecturas se reanudan a medianoche',
  },
  unreachable: {
    en: 'Neviweb does not answer: new try at the next reading',
    fr: 'Neviweb ne répond pas : nouvel essai à la prochaine lecture',
    de: 'Neviweb antwortet nicht: neuer Versuch bei der nächsten Abfrage',
    es: 'Neviweb no responde: nuevo intento en la próxima lectura',
  },
  noLocation: {
    en: 'No Neviweb location matches the names of the configuration',
    fr: 'Aucun emplacement Neviweb ne correspond aux noms de la configuration',
    de: 'Kein Neviweb-Standort passt zu den Namen der Konfiguration',
    es: 'Ninguna ubicación Neviweb coincide con los nombres de la configuración',
  },
  initFailed: {
    en: 'Initialization failed: see the integration logs',
    fr: "Échec de l'initialisation : voir les journaux de l'intégration",
    de: 'Initialisierung fehlgeschlagen: sieh dir die Protokolle der Integration an',
    es: 'Error de inicialización: consulte los registros de la integración',
  },
  // Widget
  widgetNoThermostat: {
    en: 'No thermostat added to Gladys yet',
    fr: 'Aucun thermostat ajouté à Gladys pour l’instant',
    de: 'Noch kein Thermostat zu Gladys hinzugefügt',
    es: 'Aún no hay ningún termostato añadido a Gladys',
  },
  widgetWaiting: {
    en: 'Waiting for the first Neviweb reading',
    fr: 'En attente de la première lecture Neviweb',
    de: 'Warte auf die erste Neviweb-Abfrage',
    es: 'Esperando la primera lectura de Neviweb',
  },
  widgetPeak: {
    en: 'Éco-Sinopé peak period in progress',
    fr: 'Période de pointe Éco-Sinopé en cours',
    de: 'Éco-Sinopé-Spitzenzeit läuft',
    es: 'Periodo punta Éco-Sinopé en curso',
  },
  widgetOff: {
    en: 'off',
    fr: 'arrêt',
    de: 'aus',
    es: 'apagado',
  },
  widgetHome: {
    en: 'Home',
    fr: 'Maison',
    de: 'Zuhause',
    es: 'En casa',
  },
  widgetAway: {
    en: 'Away',
    fr: 'Absent',
    de: 'Abwesend',
    es: 'Ausente',
  },
};

/** Messages built from values. */
export const MESSAGES = {
  refused: (code) => ({
    en: `Neviweb refused the request (${code})`,
    fr: `Neviweb a refusé la requête (${code})`,
    de: `Neviweb hat die Anfrage abgelehnt (${code})`,
    es: `Neviweb rechazó la solicitud (${code})`,
  }),

  publishFailed: (detail) => ({
    en: `Publishing the devices to Gladys failed: ${detail}`,
    fr: `La publication des appareils dans Gladys a échoué : ${detail}`,
    de: `Die Veröffentlichung der Geräte in Gladys ist fehlgeschlagen: ${detail}`,
    es: `La publicación de los dispositivos en Gladys falló: ${detail}`,
  }),

  /**
   * Result of the connection test.
   * @param {{ locations: string[], supported: number, unsupported: string[], requests: number }} report
   */
  testResult: ({ locations, supported, unsupported, requests }) => {
    const names = locations.join(', ');
    const others = unsupported.join(', ');
    return {
      en:
        `Connected to Neviweb: ${locations.length} location(s) (${names}), ${supported} supported device(s)` +
        (unsupported.length ? `, not supported: ${others}` : '') +
        `. ${requests} Neviweb requests today.`,
      fr:
        `Connecté à Neviweb : ${locations.length} emplacement(s) (${names}), ${supported} appareil(s) pris en charge` +
        (unsupported.length ? `, non pris en charge : ${others}` : '') +
        `. ${requests} requêtes Neviweb aujourd’hui.`,
      de:
        `Mit Neviweb verbunden: ${locations.length} Standort(e) (${names}), ${supported} unterstützte(s) Gerät(e)` +
        (unsupported.length ? `, nicht unterstützt: ${others}` : '') +
        `. ${requests} Neviweb-Anfragen heute.`,
      es:
        `Conectado a Neviweb: ${locations.length} ubicación(es) (${names}), ${supported} dispositivo(s) compatible(s)` +
        (unsupported.length ? `, no compatibles: ${others}` : '') +
        `. ${requests} solicitudes Neviweb hoy.`,
    };
  },

  locationMode: (mode, count) => {
    const away = mode === 'away';
    return {
      en: `${away ? 'Away' : 'Home'} mode sent to ${count} Neviweb location(s)`,
      fr: `Mode ${away ? 'absent' : 'maison'} envoyé à ${count} emplacement(s) Neviweb`,
      de: `${away ? 'Abwesend' : 'Zuhause'}-Modus an ${count} Neviweb-Standort(e) gesendet`,
      es: `Modo ${away ? 'ausente' : 'en casa'} enviado a ${count} ubicación(es) Neviweb`,
    };
  },
};

/** The text of a multi-language object in one language, English otherwise. */
export function pick(text, language) {
  return text[language] ?? text.en;
}

/** The connection status message of a Neviweb error. */
export function errorStatus(err) {
  switch (err?.code) {
    case 'NOT_CONFIGURED':
      return TEXT.notConfigured;
    case 'USRBADLOGIN':
    case 'LOGIN_BLOCKED':
      return TEXT.badLogin;
    case 'ACCSESSEXC':
    case 'ACCRATELIMIT':
    case 'LOGIN_COOLDOWN':
      return TEXT.tooManySessions;
    case 'NO_LOCATION':
      return TEXT.noLocation;
    case 'ACCDAYREQMAX':
    case 'DAILY_BUDGET':
      return TEXT.dailyLimit;
    case 'NETWORK':
    case 'TIMEOUT':
    case 'MAINTENANCE':
    case 'SVCERR':
      return TEXT.unreachable;
    default:
      return MESSAGES.refused(err?.code ?? 'UNKNOWN');
  }
}
