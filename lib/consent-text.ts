// Builds the participant consent form. Pure (no server imports) so the facilitator's preview and the
// stored version are produced by the same code. Covers GDPR Art. 6(1)(a), 7, 8, 9(2)(a), 13 and 22, and,
// when health data is enabled, the core elements of a HIPAA authorization (45 CFR 164.508(c)).

export type ConsentSettings = {
  controllerName: string;      // who decides why and how the data is processed
  controllerContact: string;   // email or address for questions and requests
  dpoContact: string;          // data protection officer, if any
  purpose: string;             // why contributions are collected and what the results are used for
  hosting: string;             // where data is stored
  transfers: string;           // international transfers and safeguards
  retention: string;           // how long contributions and answers are kept
  authority: string;           // supervisory authority for complaints
  minAge: number;              // age of digital consent
  healthData: boolean;         // the project may collect health information (GDPR Art. 9 + HIPAA authorization)
  hipaaExpiry: string;         // HIPAA: expiration date or event
  extra: string;               // anything else the facilitator must tell participants
};

export type ConsentContext = {
  projectName: string;
  mediaRetentionDays: number | null;
  ai: { synthesis: string | null; vision: string | null; video?: string | null; transcription: string | null };
};

export type ConsentCheck = { id: "core" | "age" | "recordings" | "health" | "hipaa"; label: string; required: boolean };
export type ConsentSection = { heading: string; paragraphs: string[] };
export type ConsentDocument = { title: string; intro: string; sections: ConsentSection[]; checks: ConsentCheck[]; signature: string };

export const DEFAULT_SETTINGS: Omit<ConsentSettings, "controllerName" | "controllerContact" | "purpose"> = {
  dpoContact: "",
  hosting: "On the server that runs this Lofn installation.",
  transfers:
    "The AI provider listed above may process data outside the EU/EEA, for example in the United States. Where it does, the transfer relies on safeguards such as the EU Standard Contractual Clauses or the EU–US Data Privacy Framework.",
  retention: "Until the project is deleted by the facilitator, and no longer than needed for the purpose above.",
  authority: "Your national data protection authority. In Norway this is Datatilsynet (datatilsynet.no).",
  minAge: 16,
  healthData: false,
  hipaaExpiry: "",
  extra: "",
};

export function buildConsent(s: ConsentSettings, ctx: ConsentContext): ConsentDocument {
  const ai = [
    ctx.ai.synthesis && `combining contributions into group answers (${ctx.ai.synthesis})`,
    ctx.ai.vision && `describing photos (${ctx.ai.vision})`,
    ctx.ai.video && `describing frames from videos (${ctx.ai.video})`,
    ctx.ai.transcription && `transcribing speech (${ctx.ai.transcription})`,
  ].filter(Boolean) as string[];
  const media =
    ctx.mediaRetentionDays === null
      ? "Uploaded photos, recordings and videos are kept as long as the rest of the project."
      : `Uploaded photos, recordings and videos are deleted ${ctx.mediaRetentionDays} day${ctx.mediaRetentionDays === 1 ? "" : "s"} after the round they were sent in ends; their transcripts and descriptions are kept with the project.`;

  const sections: ConsentSection[] = [
    {
      heading: "Who is responsible",
      paragraphs: [
        `${s.controllerName} is the data controller for this project and decides how your contributions are used.`,
        `Contact: ${s.controllerContact}.${s.dpoContact ? ` Data protection officer: ${s.dpoContact}.` : ""}`,
      ],
    },
    { heading: "Why your input is collected", paragraphs: [s.purpose] },
    {
      heading: "What is collected",
      paragraphs: [
        "What you choose to send: text, voice recordings, photos and videos, and the name you entered (optional).",
        "What Lofn derives from it: transcripts of speech and written descriptions of photos and video frames.",
        "Technical data needed to run the session: a random session cookie, your group, an anonymous label (such as P4) and when you contributed. Your IP address is not stored with your contributions.",
        s.healthData
          ? "This project may involve health information. Only share health information about yourself that you are comfortable sharing, and never share health information about other people."
          : "Please do not share health information, or other sensitive details such as religious or political beliefs, about yourself or anyone else.",
      ],
    },
    {
      heading: "How it is processed",
      paragraphs: [
        "Every minute or so, AI combines your group's contributions into one shared answer that cites the contributions it is based on.",
        ai.length
          ? `The AI services used are: ${ai.join("; ")}. They process your contributions on behalf of the controller and do not use them to make decisions about you.`
          : "This project currently runs without an AI service; contributions are listed rather than combined.",
        "No decision with legal or similarly significant effects on you is made by automated means.",
      ],
    },
    {
      heading: "Who can see it",
      paragraphs: [
        "Your group sees your contributions under your name or anonymous label. The facilitator sees all contributions, the group answers and this signed form. The facilitator may share the combined answers, which cite contributions by number, in reports.",
        `Stored: ${s.hosting}`,
        s.transfers,
      ],
    },
    { heading: "How long it is kept", paragraphs: [s.retention, media] },
    {
      heading: "Your rights",
      paragraphs: [
        "Taking part is voluntary. You can decline now, or withdraw your consent at any time with “Withdraw consent” in Lofn, without giving a reason and without any consequences for you. Withdrawal does not affect processing that happened before it.",
        "When you withdraw, your contributions and uploads are deleted and the group answers are rewritten without them. Earlier versions of an answer, and reports already shared, may still contain wording based on your contributions.",
        `You have the right to access, correct, delete, restrict and receive a copy of your data (“Download my data” in Lofn), and to object to its processing. Contact ${s.controllerContact} to exercise these rights.`,
        `You can complain to ${s.authority}`,
      ],
    },
  ];
  if (s.extra.trim()) sections.push({ heading: "Further information", paragraphs: s.extra.trim().split(/\n{2,}/) });
  if (s.healthData)
    sections.push({
      heading: "Authorization to use health information (HIPAA)",
      paragraphs: [
        `Information covered: any health information about you that you include in your contributions to “${ctx.projectName}”, and the transcripts and descriptions made from them.`,
        `Who may use and receive it: ${s.controllerName}, the facilitators of this project${ai.length ? ", and the AI services named above" : ""}.`,
        `Purpose: ${s.purpose}`,
        `This authorization expires: ${s.hipaaExpiry || "when the project is deleted"}.`,
        `You may revoke this authorization at any time by choosing “Withdraw consent” in Lofn or by writing to ${s.controllerContact}. Revoking does not affect anything done in reliance on it before the revocation.`,
        "Your treatment, payment, enrollment in a health plan, or eligibility for benefits will not depend on whether you sign this authorization.",
        "Information disclosed under this authorization may be redisclosed by the recipient and may then no longer be protected by federal privacy rules.",
        "You are entitled to a copy of this signed authorization; you can view and download it in Lofn at any time.",
      ],
    });

  const checks: ConsentCheck[] = [
    { id: "core", label: "I have read this information and consent to my contributions being processed as described.", required: true },
    { id: "age", label: `I am at least ${s.minAge} years old.`, required: true },
    {
      id: "recordings",
      label: "I also consent to sending voice recordings, photos and videos, which may show or identify me. Without this I can still contribute in writing.",
      required: false,
    },
  ];
  if (s.healthData) {
    checks.push({ id: "health", label: "I explicitly consent to the processing of any health information I choose to share (GDPR Art. 9(2)(a)).", required: false });
    checks.push({ id: "hipaa", label: "I authorize the use and disclosure of my health information as described in the HIPAA authorization above.", required: false });
  }

  return {
    title: `Consent to take part in “${ctx.projectName}”`,
    intro: "Before you contribute, please read how your input will be used. You can withdraw at any time.",
    sections,
    checks,
    signature: "Type your full name as your signature. Only the facilitator sees it; your group does not.",
  };
}

/** Plain-text rendering stored with every version (what the participant saw, word for word). */
export function consentToText(d: ConsentDocument): string {
  return [
    d.title,
    "",
    d.intro,
    ...d.sections.flatMap((s) => ["", s.heading.toUpperCase(), ...s.paragraphs]),
    "",
    "DECLARATIONS",
    ...d.checks.map((c) => `[${c.required ? "required" : "optional"}] ${c.label}`),
    "",
    d.signature,
  ].join("\n");
}
