# App Store listing

Ready to paste into App Store Connect for the Safari version (iPhone, iPad, and Mac). Product only, same voice as `docs/store-listing.md`. Apple's rules shape three choices here: no other platform or browser is named (guideline 2.3.10), no other company's product names appear in the keywords (2.3.7), and the Safari build has no Pro tab, because an app may not link to a purchase made elsewhere (3.1.1).

## Name (30 characters max)
AI Off

## Subtitle (30 characters max)
Hide AI on the sites you use

## Promotional text (170 characters max, can change without review)
One switch hides AI answers, AI buttons, and AI prompts on the sites you already use. Free, with readable rules, no account, and no AI inside.

## Description

AI Off is a Safari extension that hides AI features added to the websites you use. Keep the page. Put the prompts, sidebars, and summaries out of the way.

It is free. There is no account and no trial timer.

Choose from four levels:

1. Hide AI features. Remove supported AI answers in search, writing prompts, sidebars, and other AI controls inside web pages.

2. Quiet the AI conversation. Also collapse posts, headlines, videos, and ads that match the AI word list into a gray bar. Tap Show to read one.

3. Hide AI-made content. Also hide images that declare AI generation, known AI content farms, and posts the platform labels as AI-made. This uses labels and lists. It cannot identify every piece of AI content.

4. Blackout. Also block listed AI services in Safari, including chatbots and generators. Choose this level deliberately. Levels 1 to 3 leave chatbots alone.

Every decision comes from a readable rule, word list, selector, domain list, or label. AI Off contains no AI. It does not detect, judge, or learn.

Pause on a site, pause for 15 minutes, or flip the switch back.

There is no telemetry and no data collection. Signed rules update without an app update. Level 3 may also fetch lists and image files to read labels. Every request is listed on the privacy page.

To turn it on: open Settings, Apps, Safari, Extensions, AI Off, and allow it. Safari asks which websites AI Off may work on; it can only hide AI on sites you allow.

AI Off works inside Safari. It does not change other apps or the AI features built into the device. Rules can miss targets. Pause AI Off on a site if a page looks wrong.

The code and rules are open source under the MIT license.

## Keywords (100 characters max, comma separated, no spaces)
hide AI,AI overview,AI summary,block AI,no AI,AI answers,chatbot,search,safari extension,clean web

## URLs
- Support URL: https://aioff.app
- Marketing URL: https://aioff.app
- Privacy Policy URL: https://aioff.app/privacy/

## Categories
- Primary: Utilities
- Secondary: Productivity

## Price and availability
Free. All countries and regions.

## Age rating
4+. Answer None to every content question. Unrestricted Web Access: No (AI Off is an extension for Safari, not a browser).

## App Privacy
Data Not Collected. AI Off collects no data from the device. Its requests fetch the signed rules feed and, at Level 3, public lists; none carries anything about the person.

## Copyright
The year and the legal name of the account holder, as on the Apple Developer account.

## Sign-in required
No.

## Notes for App Review

AI Off is a Safari web extension. No account, sign-in, or purchase exists in the app.

To test:
1. Open Settings, Apps, Safari, Extensions, AI Off. Turn on Allow Extension, and under Permissions choose Allow for All Websites.
2. In Safari, search google.com or bing.com for "why is the sky blue". The AI answer block and the AI tabs are hidden, and Google results open in the Web view.
3. Tap the Extensions button in Safari's address bar, then AI Off. Flip the switch to show the AI elements again.
4. In the same panel choose Level 4 and visit a listed chatbot site. AI Off shows its own blocked page with a Pause button.

The extension contains no AI and no remote code. It downloads a signed JSON data file of CSS selectors, words, and domains from rules.aioff.app and verifies the signature on the device before use. All logic ships inside the app. Source: https://github.com/joecool1493/aioff

## Screenshots
Apple requires real captures of the app in use. Take them on the iPhone after the TestFlight install (step P4), in Safari: a search with AI Off on, the AI Off panel open over a page, and the level choices. Required sizes are the 6.9 inch iPhone and the 13 inch iPad; a Mac listing takes 1280 by 800, and `docs/store/08` to `10` (Google before and after) fit once retaken in Safari.
