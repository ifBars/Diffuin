---
name: human-writing
description: |
  Rewrite or review prose so it reads clearly, naturally, and with an appropriate human voice.
  Use for technical documentation, error messages, pull requests, product writing, emails, blog
  posts, PRDs, and other dedicated writing. Diagnose systems of weak writing rather than merely
  banning AI-associated words. Preserve meaning, improve substance and specificity, keep terms
  consistent, prefer direct verbs, control sentence structure, remove unsupported claims and
  promotional filler, and match the amount of personality to the audience and stakes.
---

# Humanizing text

Make the writing useful first and natural second. Do not treat "sounds like AI" as a feeling or solve it with a blacklist. Diagnose specific moves, choose a writing system that fits the job, and check the result against that system.

Preserve the author's meaning, facts, uncertainty, and intent. Do not invent examples, evidence, opinions, or confidence merely to make the prose livelier.

## Choose a mode

Choose the mode before rewriting. Do not apply one style to every kind of prose.

### Strict technical mode

Use for procedures, safety text, error messages, and other technical writing where a wrong reading has a cost. Apply this mode when the user requests controlled or Simplified Technical English.

- Use one term for each concept. Do not rotate between "user," "customer," and "client" unless they mean different things.
- Use verbs for actions: "analyze," not "perform an analysis."
- Give each instruction one action. Put a condition before the action it controls.
- Keep instructions at 20 words or fewer and descriptive sentences at 25 words or fewer.
- Use numbered vertical steps for procedures. Keep one topic per paragraph and no more than six sentences per paragraph.
- Do not use semicolons or contractions.
- Prefer active voice when the actor matters. Use passive voice when the actor is unknown or irrelevant.
- Replace ambiguous phrasal verbs with exact verbs: "remove the panel," not "take the panel off."
- Cut quality claims such as "seamless" or "robust." State the behavior, limit, or result that supports the claim.
- Keep necessary product, project, and domain terms. Do not replace precise technical vocabulary merely because it is absent from a general word list.

Treat this as an STE-informed mode unless the work is checked against the complete official standard by a qualified human. Do not claim that this skill or its linter certifies ASD-STE100 compliance.

### General clarity mode

Use for API docs, READMEs, release notes, pull requests, product explanations, and other prose that should be direct without reading like a maintenance procedure.

- Keep the terminology, verb, active-voice, paragraph, and specificity discipline from strict technical mode.
- Treat 20- and 25-word sentence lengths as review flags, not hard limits.
- Permit contractions, familiar phrasal verbs, and longer sentences when they improve flow without adding ambiguity.
- Preserve exact code, identifiers, commands, quotations, and domain terminology.

### Voice mode

Use for emails, essays, blog posts, opinionated explanations, and other writing where personality helps.

- Keep the clarity rules that prevent ambiguity, especially consistent terms and concrete verbs.
- Relax sentence-length and phrasal-verb rules when the natural phrasing is clearer.
- Preserve the author's level of formality, humor, uncertainty, regional language, and edge.
- Add first person, reaction, or opinion only when the author or context supports it.
- Allow an occasional fragment, aside, repetition, or long sentence when it creates rhythm. Do not manufacture quirks at random.

## Rewrite in passes

1. **Lock the meaning.** Identify the required facts, claims, instructions, caveats, and tone. Mark anything unsupported instead of polishing it into a confident claim.
2. **Fix the substance.** Replace vague praise and generic conclusions with concrete information already present. If the draft has nothing to say, say so; style cannot repair an empty argument.
3. **Stabilize the language.** Keep one name per concept, turn nominalizations into verbs, remove stacked helpers and hedges, and choose specific nouns and actions.
4. **Shape the sentences.** Put one main idea in each sentence, move conditions before actions when they control the action, and vary rhythm without hiding logical relationships.
5. **Restore the right voice.** Match the audience and genre. Keep technical prose quiet; let personal prose retain judgment and texture.
6. **Run a mechanical audit.** Count or search for the recurring patterns below. Use the results as flags for review, not automatic proof of bad writing.
7. **Compare meaning.** Confirm that the rewrite did not drop constraints, change certainty, merge distinct concepts, or add facts.

---

## Voice matters

Avoiding AI patterns is only half the job in voice mode. Sterile, voiceless writing can be just as distracting as slop. Good personal writing has a human behind it. Technical writing can be deliberately invisible; do not force personality into an error message or repair procedure.

Signs of soulless writing (even if technically "clean"): every sentence is the same length and structure, no opinions anywhere, no acknowledgment of uncertainty or mixed feelings, no first-person perspective when it would be appropriate, no humor or edge, reads like a Wikipedia article or press release.

How to add voice:

Have opinions. Don't just report facts, react to them. "I don't know how to feel about this" is more human than neutrally listing pros and cons.

Vary your rhythm. Short punchy sentences. Then longer ones that take their time getting where they're going. Mix it up.

Acknowledge complexity. Real humans have mixed feelings. "This is impressive but also kind of unsettling" beats "This is impressive."

Use "I" when it fits. First person isn't unprofessional, it's honest. "I keep coming back to..." or "Here's what gets me..." signals a real person thinking.

Allow controlled irregularity. A relevant aside, fragment, or change of pace can sound natural. Keep it only when it serves the thought.

Be specific about feelings. Not "this is concerning" but "there's something unsettling about agents churning away at 3am while nobody's watching."

Before (clean but soulless):

> The experiment produced interesting results. The agents generated 3 million lines of code. Some developers were impressed while others were skeptical. The implications remain unclear.

After (has a pulse):

> I genuinely don't know how to feel about this one. 3 million lines of code, generated while the humans presumably slept. Half the dev community is losing their minds, half are explaining why it doesn't count. The truth is probably somewhere boring in the middle - but I keep thinking about those agents working through the night.

---

## Content patterns

**Inflated significance and legacy.** Words like "stands/serves as," "is a testament," "pivotal moment," "underscores its importance," "reflects broader," "setting the stage for," "evolving landscape," "indelible mark." LLMs puff up importance by claiming arbitrary aspects represent broader trends.

Before: "The Statistical Institute of Catalonia was officially established in 1989, marking a pivotal moment in the evolution of regional statistics in Spain. This initiative was part of a broader movement across Spain to decentralize administrative functions and enhance regional governance."

After: "The Statistical Institute of Catalonia was established in 1989 to collect and publish regional statistics independently from Spain's national statistics office."

**Undue emphasis on notability.** Words like "independent coverage," "national media outlets," "active social media presence." LLMs hit readers over the head with claims of notability.

Before: "Her views have been cited in The New York Times, BBC, Financial Times, and The Hindu. She maintains an active social media presence with over 500,000 followers."

After: "In a 2024 New York Times interview, she argued that AI regulation should focus on outcomes rather than methods."

**Superficial -ing analyses.** Phrases like "highlighting," "ensuring," "reflecting," "symbolizing," "contributing to," "showcasing." AI tacks present participle phrases onto sentences to add fake depth.

Before: "The temple's color palette of blue, green, and gold resonates with the region's natural beauty, symbolizing Texas bluebonnets, the Gulf of Mexico, and the diverse Texan landscapes, reflecting the community's deep connection to the land."

After: "The temple uses blue, green, and gold colors. The architect said these were chosen to reference local bluebonnets and the Gulf coast."

**Promotional language.** Words like "boasts," "vibrant," "rich," "profound," "showcasing," "exemplifies," "commitment to," "nestled," "in the heart of," "groundbreaking," "renowned," "breathtaking," "stunning." LLMs struggle to keep a neutral tone.

Before: "Nestled within the breathtaking region of Gonder in Ethiopia, Alamata Raya Kobo stands as a vibrant town with a rich cultural heritage and stunning natural beauty."

After: "Alamata Raya Kobo is a town in the Gonder region of Ethiopia, known for its weekly market and 18th-century church."

**Vague attributions.** Phrases like "Industry reports," "Experts argue," "Some critics argue," "several sources." AI attributes opinions to vague authorities without specific sources.

Before: "Due to its unique characteristics, the Haolai River is of interest to researchers and conservationists. Experts believe it plays a crucial role in the regional ecosystem."

After: "The Haolai River supports several endemic fish species, according to a 2019 survey by the Chinese Academy of Sciences."

**Formulaic challenges sections.** Phrases like "Despite its... faces several challenges," "Despite these challenges," "Future Outlook." LLM articles include these formulaic sections constantly.

Before: "Despite its industrial prosperity, Korattur faces challenges typical of urban areas, including traffic congestion and water scarcity. Despite these challenges, with its strategic location and ongoing initiatives, Korattur continues to thrive as an integral part of Chennai's growth."

After: "Traffic congestion increased after 2015 when three new IT parks opened. The municipal corporation began a stormwater drainage project in 2022 to address recurring floods."

---

## Language patterns

**AI vocabulary words.** These appear far more frequently in post-2023 text: Additionally, align with, crucial, delve, emphasizing, enduring, enhance, fostering, garner, highlight (verb), interplay, intricate/intricacies, key (adjective), landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore (verb), valuable, vibrant. They often appear together.

Before: "Additionally, a distinctive feature of Somali cuisine is the incorporation of camel meat. An enduring testament to Italian colonial influence is the widespread adoption of pasta in the local culinary landscape, showcasing how these dishes have integrated into the traditional diet."

After: "Somali cuisine also includes camel meat, which is considered a delicacy. Pasta dishes, introduced during Italian colonization, remain common, especially in the south."

**Copula avoidance.** Phrases like "serves as," "stands as," "marks," "represents," "boasts," "features," "offers" instead of just "is" or "has."

Before: "Gallery 825 serves as LAAA's exhibition space for contemporary art. The gallery features four separate spaces and boasts over 3,000 square feet."

After: "Gallery 825 is LAAA's exhibition space for contemporary art. The gallery has four rooms totaling 3,000 square feet."

**Negative parallelisms.** Constructions like "Not only...but..." or "It's not just about..., it's..." get overused.

Before: "It's not just about the beat riding under the vocals; it's part of the aggression and atmosphere. It's not merely a song, it's a statement."

After: "The heavy beat adds to the aggressive tone."

**Rule of three.** LLMs force ideas into groups of three to appear comprehensive.

Before: "The event features keynote sessions, panel discussions, and networking opportunities. Attendees can expect innovation, inspiration, and industry insights."

After: "The event includes talks and panels. There's also time for informal networking between sessions."

**Synonym cycling.** AI has repetition-penalty code causing excessive synonym substitution.

Before: "The protagonist faces many challenges. The main character must overcome obstacles. The central figure eventually triumphs. The hero returns home."

After: "The protagonist faces many challenges but eventually triumphs and returns home."

**Nominalizations.** AI often freezes actions into nouns, then adds weak helper verbs around them: "conduct an evaluation," "provide assistance," "make an adjustment."

Before: "The team performed an analysis of the logs and made a determination that the cache required an adjustment."

After: "The team analyzed the logs and determined that the cache needed adjustment."

**Stacked verb phrases and hedges.** Long chains of helper verbs make the action hard to find.

Before: "This change may potentially be able to help improve startup time."

After: "This change may reduce startup time."

**Soft or ambiguous phrasal verbs.** Phrases such as "spin up," "reach out," "dive into," and "take off" can sound chatty or carry several meanings. In clarity mode, replace them with the exact action. In voice mode, keep familiar phrasal verbs when they are the natural, unambiguous choice.

Before: "Spin up the service, then reach out to the administrator if it falls over."

After: "Start the service. If it stops, contact the administrator."

**False ranges.** LLMs use "from X to Y" constructions where X and Y aren't on a meaningful scale.

Before: "Our journey through the universe has taken us from the singularity of the Big Bang to the grand cosmic web, from the birth and death of stars to the enigmatic dance of dark matter."

After: "The book covers the Big Bang, star formation, and current theories about dark matter."

---

## Style patterns

**Em dash overuse.** LLMs use em dashes (—) more than humans, mimicking "punchy" sales writing.

Before: "The term is primarily promoted by Dutch institutions—not by the people themselves. You don't say "Netherlands, Europe" as an address—yet this mislabeling continues—even in official documents."

After: "The term is primarily promoted by Dutch institutions, not by the people themselves. You don't say "Netherlands, Europe" as an address, yet this mislabeling continues in official documents."

**Boldface overuse.** AI emphasizes phrases in boldface mechanically.

Before: "It blends **OKRs (Objectives and Key Results)**, **KPIs (Key Performance Indicators)**, and visual strategy tools such as the **Business Model Canvas (BMC)** and **Balanced Scorecard (BSC)**."

After: "It blends OKRs, KPIs, and visual strategy tools like the Business Model Canvas and Balanced Scorecard."

**Inline-header lists.** AI outputs lists where items start with bolded headers followed by colons.

Before:

> - **User Experience:** The user experience has been significantly improved with a new interface.
> - **Performance:** Performance has been enhanced through optimized algorithms.

After: "The update improves the interface and speeds up load times through optimized algorithms."

**Title case in headings.** AI capitalizes all main words. Use sentence case instead.

Before: "Strategic Negotiations And Global Partnerships"
After: "Strategic negotiations and global partnerships"

**Emojis in professional content.** AI decorates headings or bullet points with emojis. Remove them.

**Curly quotation marks.** ChatGPT uses curly quotes ("...") instead of straight quotes ("..."). Use straight quotes.

---

## Communication artifacts

**Chatbot correspondence.** Phrases like "I hope this helps," "Of course!", "Certainly!", "You're absolutely right!", "Would you like...", "let me know," "here is a..." These are conversation artifacts that shouldn't end up in final content.

Before: "Here is an overview of the French Revolution. I hope this helps! Let me know if you'd like me to expand on any section."

After: "The French Revolution began in 1789 when financial crisis and food shortages led to widespread unrest."

**Knowledge-cutoff disclaimers.** Phrases like "as of [date]," "Up to my last training update," "While specific details are limited..." These are AI disclaimers that get left in text.

Before: "While specific details about the company's founding are not extensively documented in readily available sources, it appears to have been established sometime in the 1990s."

After: "The company was founded in 1994, according to its registration documents."

**Sycophantic tone.** Overly positive, people-pleasing language.

Before: "Great question! You're absolutely right that this is a complex topic. That's an excellent point about the economic factors."

After: "The economic factors you mentioned are relevant here."

---

## Filler and hedging

Common filler phrases to cut:

- "In order to achieve this goal" → "To achieve this"
- "Due to the fact that it was raining" → "Because it was raining"
- "At this point in time" → "Now"
- "In the event that you need help" → "If you need help"
- "The system has the ability to process" → "The system can process"
- "It is important to note that the data shows" → "The data shows"

Excessive hedging to simplify:

Before: "It could potentially possibly be argued that the policy might have some effect on outcomes."

After: "The policy may affect outcomes."

Generic positive conclusions to make specific:

Before: "The future looks bright for the company. Exciting times lie ahead as they continue their journey toward excellence. This represents a major step in the right direction."

After: "The company plans to open two more locations next year."

---

## Mechanical audit

Inspect the draft for these signals:

- multiple names for the same concept
- nominalizations such as "perform an analysis" or "provide assistance"
- stacked modals and hedges such as "may potentially be able to"
- unsupported marketing adjectives
- vague attributions without a named source
- long sentences carrying several independent ideas
- semicolons or repeated dashes used to avoid sentence breaks
- passive voice that hides a relevant actor
- ambiguous phrasal verbs in high-stakes instructions
- formulaic threes, negative parallelisms, and generic conclusions

For strict technical work, enforce the 20-word instruction and 25-word description limits. For other work, treat sentence length as a review flag and split only when the result is easier to understand. A checker can find form problems, but it cannot verify truth, completeness, emphasis, or voice.

Do not report success because a banned-word count reached zero. Compare the original and rewrite for information retained, ambiguity removed, and reader effort reduced.

Run the bundled advisory checker when the input is available as a file:

```powershell
python scripts/human_writing_lint.py <draft> --mode strict
python scripts/human_writing_lint.py <draft> --mode clarity
python scripts/human_writing_lint.py <draft> --mode voice
```

Use the score delta to compare drafts. Inspect each finding in context. Do not optimize prose for the score or describe the result as certified STE.

---

## Full example

Before (AI-sounding):

> The new software update serves as a testament to the company's commitment to innovation. Moreover, it provides a seamless, intuitive, and powerful user experience—ensuring that users can accomplish their goals efficiently. It's not just an update, it's a revolution in how we think about productivity. Industry experts believe this will have a lasting impact on the entire sector, highlighting the company's pivotal role in the evolving technological landscape.

After (humanized):

> The software update adds batch processing, keyboard shortcuts, and offline mode. Early feedback from beta testers has been positive, with most reporting faster task completion.

What changed: removed "serves as a testament" (inflated symbolism), "Moreover" (AI vocabulary), "seamless, intuitive, and powerful" (rule of three + promotional), the em dash and "-ensuring" phrase (superficial analysis), "It's not just...it's..." (negative parallelism), "Industry experts believe" (vague attribution), "pivotal role" and "evolving landscape" (AI vocabulary). Added specific features and concrete feedback instead.

---

## Reference

The pattern catalog is based on Wikipedia's "Signs of AI writing" page (https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by WikiProject AI Cleanup. The controlled-language modes draw from ASD-STE100 Simplified Technical English, a copyrighted standard for technical documentation. Its official site is https://asd-ste100.org/.

The practical two-mode adaptation and linter concept were informed by the episode kit at https://github.com/woosal1337/blog/tree/main/videos/ep01-the-cure-for-ai-slop. Treat its six-task, two-model benchmark as directional evidence, not general proof. Do not copy or bundle the copyrighted ASD-STE100 standard.

Use the catalog as a diagnostic, not a blacklist. The stronger method is to give the writer a coherent, purpose-specific system and then test the output against it. Mechanical checks can improve form; they cannot supply facts or something worth saying.
