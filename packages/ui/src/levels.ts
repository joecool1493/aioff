export const LEVELS = [
  {
    level: 1 as const,
    name: 'Hide AI features',
    short: 'Features',
    detail:
      'Removes AI built into sites: Google AI Overviews, Gemini in Gmail, Copilot panels, Meta AI, Grok, Rufus, and "Ask AI" buttons.',
  },
  {
    level: 2 as const,
    name: 'Quiet the AI conversation',
    short: 'Conversation',
    detail: 'Level 1, plus collapses posts, headlines, videos, and ads that talk about AI. You can always click to show one.',
  },
  {
    level: 3 as const,
    name: 'Hide AI-made content',
    short: 'Content',
    detail:
      'Level 2, plus hides images and video that declare they are AI generated (Content Credentials), known AI content farms, and AI channels.',
  },
  {
    level: 4 as const,
    name: 'Blackout',
    short: 'Blackout',
    detail: 'Level 3, plus blocks AI companies at the network level. This blocks chatbots too, including ones you may use.',
  },
];
