# GToM — Design & Development Document

**Version:** 0.2 (Pre-Hackathon Draft — Vulnerability & Influence rebuild)
**Owner:** Vlad
**Last Updated:** May 2026
**Status:** Architecture lock-in phase
**Supersedes:** GToM-DDD v0.1
**Related Documents:** GOrchestrator-DDD.md, GMirror-DDD.md, GBrain (external), GStack (external)

---

## 0. Reading Guide

This document is the architectural and build-plan reference for **GToM**, the social-cognitive layer in the five-tool agent stack. It supersedes v0.1.

GToM's core function is to model the human mind not as a clean rational agent but as **a mind operating inside an information ecosystem that is actively trying to manipulate it**. The system models cognitive vulnerability, influence exposure, manipulation detection, and decision authenticity — and uses these models to defend users from manipulation by other systems (and from sub-optimal action by our own agents).

The marketed feature inside GToM is **Cognitive ICE** — Intrusion Countermeasures for the mind. This is not just a name; it is the product positioning. GToM is the system that watches users' cognitive integrity under information warfare.

Classical Theory of Mind (beliefs, desires, intentions) is preserved as a substrate component (§5) — it provides the structured mental-state grounding that the vulnerability and influence layers operate on top of. But it is not the headline. The headline is cognitive defense.

Sections 1–3: *what* and *why*.
Sections 4–8: *how*.
Section 9: build plan, hackathon through V3.
Sections 10–12: risk, open questions, appendix.

---

## 1. Executive Summary

GToM is a cognitive-state and cognitive-defense system. It maintains, per user, a continuously updated model of:

- What the user *believes, wants, and intends* (the classical Theory of Mind substrate).
- Which **cognitive biases and vulnerabilities** are currently elevated in this user, in this moment.
- What **manipulative influences** the user has been exposed to recently — by other systems, content, or designs.
- How **authentic** any given decision or utterance is — i.e., how likely it is to reflect the user's stable values vs. their currently-induced state.

These models drive three classes of action:

1. **Defend** the user from external manipulation by detecting it and surfacing it.
2. **Adapt** our agents' behavior so they do not act on inauthentic requests without appropriate friction.
3. **Refuse** to ourselves exploit any of the vulnerabilities we model — this is a hard constraint, not a soft norm.

In the broader five-tool stack, GToM is the *cognitive immune system*. GBrain is the persistent memory. GStack is the toolkit. GOrchestrator runs work in parallel. GMirror tests changes against minds. GToM watches the minds themselves for hostile incursion — and, critically, makes sure our own stack is not the source of that incursion.

### 1.1 Cognitive ICE — the product framing

The marketed name for GToM's user-protective surface is **Cognitive ICE** (Intrusion Countermeasures Electronics, for the mind). It is the feature users see and the feature buyers buy. The framing is exact, not decorative: dark patterns, manipulative content algorithms, scarcity timers, social-proof exploitation, attention-economy mechanics — these are intrusions against cognitive integrity. ICE is the layer that detects and counters them.

### 1.2 What it is

- A continuously-updated, per-user model of cognitive vulnerability state.
- An influence-exposure ledger tracking what the user has been subjected to.
- A manipulation detection engine (content, design, agent behavior).
- A decision-authenticity scorer.
- A classical Theory-of-Mind substrate (BDI structure, false-belief reasoning) supporting all of the above.
- An agent-coordination service (predicting and routing around conflicts in multi-agent runs).
- A defense and intervention engine — surfacing manipulation to users, gating agent actions on authenticity, and refusing our own agents the use of identified manipulation patterns.

### 1.3 What it is not

- It is not a memory store. That is GBrain.
- It is not a content moderation system in the platform sense. It models *the user under content*, not the content itself.
- It is not a policy enforcement system. It informs and recommends; agents and users decide.
- It is not a generalized AGI cognitive model. It is bounded, structured, and task-relevant.
- It is not a persuasion tool. The system explicitly refuses to apply the patterns it detects.
- It is not classical ToM with extra features. It is a cognitive-defense system that uses classical ToM internally.

### 1.4 Headline metrics (targets, hedged)

- **Manipulation detection precision:** ≥75% on a curated benchmark of known dark patterns and known authentic UX. Below this, false-positive friction makes the system worse than nothing.
- **Authenticity calibration:** when GToM scores a decision as low-authenticity, the user reports retrospective regret on that decision at a meaningfully higher rate than for high-authenticity decisions (target: ≥2× lift on regret signal).
- **Inauthentic-action friction:** target 40–60% of low-authenticity high-stakes actions converted to authentic actions after light friction (clarification, delay, reframing).
- **Agent coordination cost:** 40–70% fewer explicit messages between parallel agents on benchmark coordination tasks (carried over from v0.1).
- **User trust dimension:** user-reported feeling that "the system is on my side" >85% after 30 days of use.

These are aspirational. Real numbers depend heavily on benchmark choice, the manipulation taxonomy, and calibration discipline.

---

## 2. Problem Statement

### 2.1 What's wrong with how agents model users today

The dominant model of users in 2025–26 agent systems is roughly: **a rational autonomous agent with stable preferences who says what they mean**. This model is wrong in three ways that matter.

**It is wrong about rationality.** Half a century of behavioral economics has documented that human decisions are systematically biased — anchoring, loss aversion, availability, framing effects, hyperbolic discounting. These are not noise; they are structure. A user model that ignores them mis-predicts behavior on the precise edges where prediction matters most.

**It is wrong about stability.** Users are not preference-stable across contexts. The same user, in the same week, at 11 AM well-rested versus 1 AM doom-scrolling, makes systematically different decisions. Most agent systems treat the 1 AM decision as canonical because it's the most recent — and proceed to act on it. This is what makes "agents that act on your behalf" sometimes feel like they are being weaponized against you.

**It is wrong about exogeneity.** Users do not arrive at the agent in a vacuum. They arrive having been shaped — minutes ago — by recommender systems, ad creative, scarcity timers, social-proof counters, framed news, dark-patterned consent flows, and engagement-tuned content. Their stated preference is often a downstream artifact of upstream manipulation. An agent that takes the stated preference at face value is collaborating with that manipulation, even when it intends not to.

GToM exists because the right response to all three is the same: **model the user as a cognitively-vulnerable mind operating inside an adversarial information ecosystem**. Build the user model on that foundation. Defend accordingly.

### 2.2 Why now

Four convergent factors make this the right system to build in 2026.

**The attention economy is at full saturation.** Manipulation patterns that were notable when Eyal wrote *Hooked* in 2014 are now ambient. Average users encounter dozens of dark patterns per day. The cost of *not* modeling this is rising faster than the cost of modeling it.

**Agents now act on user behalf.** When the agent is just a chat interface, taking the user's stated preference at face value is at worst rude. When the agent buys things, deploys things, sends messages, and changes systems, taking the inauthentic preference at face value causes real damage. The stakes of the user-modeling error have crossed a threshold.

**The research stack is mature.** Behavioral economics, persuasion psychology, dark-patterns taxonomies, persuasive-computing models, and the misinformation/inoculation literature are now sufficiently developed and operationalizable. We don't need to invent the science; we need to engineer it.

**The market is starting to demand this.** Regulatory bodies are moving on dark patterns (EU DSA, FTC actions). Users are increasingly aware of manipulation. A product that visibly defends cognitive integrity has a marketing surface that didn't exist five years ago.

### 2.3 Why GToM specifically

The space — "AI that protects users from manipulation" — is nearly empty at the product layer. Adjacent categories exist (ad blockers, tracker blockers, content filters, screen-time tools) but they operate on the *environment*, not on a *model of the user under the environment*. GToM is the first system in our knowledge that does the latter.

The defensibility:

- **Per-user cognitive vulnerability state, continuously updated.** This is the genuinely novel architectural object. Not a static persona. Not a flat preference list. A dynamic vulnerability state model.
- **Influence-exposure ledger tied to the vulnerability state.** Knowing *why* a user is currently anchored (because they just saw a specific price) is what makes the model actionable.
- **Cross-stack composition.** GMirror's synthetic users get vulnerability dimensions — you can test whether your own product exploits users. GOrchestrator gates agent actions on authenticity. GBrain stores the cognitive history alongside the factual history. The whole stack becomes coherent in a way that single-vendor "AI guardrails" products cannot match.
- **Cognitive-science depth.** Built on a real research stack: Kahneman/Tversky, Cialdini, Fogg, Brignull, Eyal, Zuboff, van der Linden, Pennycook. Not LLM heuristics with marketing on top.
- **The refusal stance.** GToM explicitly refuses to use what it detects. Competitors that detect manipulation patterns will be tempted to *deploy* them; GToM is architecturally committed not to. That commitment is a moat once users care.

---

## 3. System Overview

### 3.1 Conceptual model

GToM maintains, for each user, a structured **cognitive state** that includes:

- A classical Theory-of-Mind substrate (BDI: beliefs, desires, intentions).
- A **vulnerability state** (which biases and exploitabilities are currently elevated).
- An **influence-exposure ledger** (what manipulative inputs the user has been subject to recently).
- An **authenticity baseline** (how aligned recent decisions have been with stable values).

The system provides five primary services:

1. **Belief query** — what does the entity (user or agent) currently believe / want / intend?
2. **Vulnerability assessment** — what is this user currently susceptible to?
3. **Manipulation detection** — is this content/design/agent-behavior manipulative, and if so, how?
4. **Authenticity scoring** — how likely is this specific decision to reflect the user's stable self?
5. **Conflict prediction** — in multi-agent runs, where will agents collide?

All five share the same underlying cognitive state.

### 3.2 The defense loop

```
                          ┌──────────────────────────┐
                          │   External information   │
                          │   ecosystem              │
                          │   (content, ads, design, │
                          │    other agents, our own │
                          │    agents)               │
                          └────────────┬─────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │   Influence Exposure     │
                          │   Ledger                 │
                          │   (what hit the user)    │
                          └────────────┬─────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │   Vulnerability State    │
                          │   Update                 │
                          │   (what's elevated now)  │
                          └────────────┬─────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │   User Action            │
                          │   (utterance, decision,  │
                          │    request to agent)     │
                          └────────────┬─────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │   Authenticity Score     │
                          │   + Intent Inference     │
                          └────────────┬─────────────┘
                                       │
                          ┌────────────┼─────────────┐
                          ▼            ▼             ▼
                       Defend       Adapt          Refuse
                  (surface to    (agent acts    (agent declines
                   user,          differently   to use detected
                   suggest        based on      manipulation
                   pause)         authenticity) patterns)
```

### 3.3 The four roles GToM plays

| Role | What it does | Who it serves |
|---|---|---|
| **The empath** | Models user mental state with depth | Agents needing to act well for users |
| **Cognitive ICE** | Detects external manipulation, surfaces to user | Users |
| **The chaperone** | Gates inauthentic high-stakes actions with friction | Users (via agents) |
| **The conscience** | Refuses our own agents the use of detected manipulation patterns | The system itself |

The fourth role — the conscience — is the one that distinguishes GToM from products that simply detect manipulation. We don't just detect it; we don't allow our own agents to do it. This is the architectural commitment.

### 3.4 Cyberpunk framing

Cyberpunk fiction is, at its core, about cognitive sovereignty under information warfare. Corps tune your mood through ads piped to your neural lace. Netrunners install daemons in your headware. Braindance edits what you remember feeling. The genre's central question is: *whose mind is this, really?*

GToM is the literal answer in product form. **Cognitive ICE** stands between the user's mind and the systems trying to shape it — including, importantly, our own. Where most security ICE protects systems from intrusion, this ICE protects minds.

This framing is not decoration. It maps cleanly to architecture: the influence ledger is the intrusion log; manipulation detection is intrusion detection; the authenticity score is the integrity check; the refusal stance is the firewall rule.

---

## 4. Architecture

### 4.1 Component diagram

```
                   ┌─────────────────────────────────────────────────────┐
                   │                       GToM                          │
                   │                                                     │
   Observations ───┼─►┌───────────────────────────────────────────┐      │
   (user actions,  │  │  Observation Ingestion Pipeline           │      │
    agent actions, │  └────────────────────┬──────────────────────┘      │
    content        │                       │                              │
    exposure       │                       ▼                              │
    events)        │  ┌───────────────────────────────────────────┐      │
                   │  │  Influence Exposure Ledger                │      │
                   │  │  (what hit the user, with provenance)     │      │
                   │  └────────────────────┬──────────────────────┘      │
                   │                       │                              │
                   │                       ▼                              │
                   │  ┌───────────────────────────────────────────┐      │
                   │  │  Manipulation Detection Engine            │      │
                   │  │  (per content/design/agent action)        │      │
                   │  └────────────────────┬──────────────────────┘      │
                   │                       │                              │
                   │                       ▼                              │
                   │  ┌───────────────────────────────────────────┐      │
                   │  │  Vulnerability State Updater              │      │
                   │  │  (which biases elevated, decay,           │      │
                   │  │   reinforcement)                          │      │
                   │  └────────────────────┬──────────────────────┘      │
                   │                       │                              │
                   │                       ▼                              │
                   │  ┌───────────────────────────────────────────┐      │
                   │  │  Cognitive State Store                    │      │
                   │  │  ┌─────────────────────────────────────┐  │      │
                   │  │  │ BDI Substrate (beliefs/desires/     │  │      │
                   │  │  │   intentions/dispositions)          │  │      │
                   │  │  │ Vulnerability State                 │  │      │
                   │  │  │ Influence Ledger Summary            │  │      │
                   │  │  │ Authenticity Baseline               │  │      │
                   │  │  └─────────────────────────────────────┘  │      │
                   │  └────────────────────┬──────────────────────┘      │
                   │                       │                              │
                   │   ┌───────────────────┼───────────────┬──────────┐   │
                   │   ▼                   ▼               ▼          ▼   │
                   │ ┌────────┐   ┌──────────────┐  ┌────────────┐ ┌──┐  │
                   │ │ Belief │   │Authenticity  │  │ Conflict   │ │..│  │
                   │ │ Query  │   │Scorer +      │  │ Predictor  │ │  │  │
                   │ │ Service│   │Intent        │  │ (agents)   │ │  │  │
                   │ │        │   │Disambiguator │  │            │ │  │  │
                   │ └────┬───┘   └──────┬───────┘  └─────┬──────┘ └──┘  │
                   │      │              │                │              │
                   └──────┼──────────────┼────────────────┼──────────────┘
                          │              │                │
                          ▼              ▼                ▼
                       Agents         User-facing      GOrchestrator
                                      surfaces         (during runs)

   Sidecars:
   ────────
   GBrain   ◄── user history, exposure history (read)
   GBrain   ──► refined state, calibration events, exposure log (write)
   GMirror  ◄── vulnerability-aware synthetic user grounding (read by GMirror)
   GOrch    ◄── conflict predictions + authenticity-aware gating (subscribe)
   GStack   ◄── (skills can opt into ToM-aware wrappers)
```

### 4.2 Core components

#### 4.2.1 Observation Ingestion Pipeline

**Responsibility:** Receive all observations bearing on a user's cognitive state and normalize them into a common form.

Three observation categories matter:

- **Direct user observations** — utterances, clicks, dwell times, abandonment events, explicit preferences.
- **Influence-exposure observations** — what content, design elements, or agent behaviors the user encountered. This is the channel classical ToM completely ignores. Sources include browser instrumentation (where available), product event streams, external content metadata, and observed agent outputs from our own stack.
- **Outcome observations** — what the user actually did and (where retrievable) how they felt about it later. Regret signals are gold for calibration.

Observations are timestamped, attributed, tagged with confidence, and queued for downstream processing.

#### 4.2.2 Influence Exposure Ledger

**Responsibility:** Maintain a structured, queryable record of what manipulative or potentially-manipulative inputs the user has been subjected to in a recent time window.

The ledger is the architectural novelty of this design. It is not a content log — it is an *influence log*. Each entry records: what manipulation pattern (if any) was present in the input, what cognitive dimension it targets, when the user encountered it, and how strongly.

```typescript
type InfluenceExposureEntry = {
  exposure_id: UUID;
  user_id: UUID;
  encountered_at: Timestamp;
  source: ExposureSource;          // 'our_agent' | 'external_content' | 'product_ui' | 'other'
  source_ref: string;              // URL, message ID, screen ID, etc.
  detected_patterns: ManipulationPattern[];
  exposure_strength: number;       // [0,1] — how intense
  decay_half_life_minutes: number; // how fast its effect fades
  evidence: EvidenceRef[];
};

type ManipulationPattern = {
  pattern_id: string;              // canonical taxonomy ID
  category: ManipulationCategory;
  targets: VulnerabilityDimension[];
  severity: 'low' | 'medium' | 'high' | 'critical';
};
```

The ledger is per-user, append-only, with TTL-based decay. Older exposures are summarized into history aggregates.

Crucially, **our own agents' outputs flow into this ledger too**. If our agent uses scarcity language, social-proof framings, or anchoring sequences, those are logged as exposures. This is the architectural commitment to the conscience role.

#### 4.2.3 Manipulation Detection Engine

**Responsibility:** Given a piece of content, a UI design, or an agent action, identify which manipulation patterns are present.

The engine operates against a **taxonomy of manipulation patterns**, organized by category and grounded in research. The initial taxonomy (V1) covers:

**Persuasion-principle exploitation (Cialdini-derived):**
- Reciprocity exploitation (engineered gifts that create obligation)
- Commitment laddering (small yes → bigger yes)
- Social proof manipulation (fabricated or skewed counts)
- Authority spoofing (false credentials, manufactured expertise signaling)
- Liking exploitation (artificial rapport-building)
- Scarcity coercion (fake or manufactured urgency)

**Behavioral-economics exploitation (Kahneman/Tversky-derived):**
- Anchoring (presenting an irrelevant number to bias subsequent judgments)
- Loss framing (framing equivalent options as losses to increase aversion)
- Default bias exploitation (engineered defaults that exploit inertia)
- Decoy effects (irrelevant options structured to bias choice)
- Sunk cost amplification (emphasizing prior investment to coerce continuation)
- Hyperbolic discounting exploitation (foreground rewards, background costs)

**Dark patterns (Brignull/Gray taxonomy):**
- Roach motels (easy in, hard out)
- Confirmshaming (guilt-laden decline buttons)
- Misdirection (visual emphasis steering choices)
- Forced continuity (silent renewal, subscription traps)
- Sneak into basket (unrequested additions)
- Hidden costs revealed late
- Privacy zuckering (engineered over-sharing)

**Attention-economy mechanics (Eyal-derived, plus engagement-optimization research):**
- Variable reward scheduling (intermittent reinforcement)
- Streak coercion (loss aversion applied to engagement)
- Bottomless scroll
- Auto-play (autonomy bypass)
- Notification engineering (induced FOMO)

**Misinformation and influence operations (van der Linden, Pennycook):**
- Emotional priming for credulity
- Repetition for truthiness
- Authority laundering
- Engineered identity threats

Detection per pattern uses a combination of:
- **Pattern-specific deterministic checks** where applicable (e.g., countdown timers in checkout flows for scarcity; pre-checked opt-in boxes for default-bias exploitation).
- **LLM-based classifiers** for text content with structured prompts that score against named patterns.
- **Behavioral fingerprinting** for agent actions (an agent that introduces a price, then introduces a higher reference price, is anchoring).

Detection produces structured outputs with severity, confidence, and evidence. False positives are expected; calibration is continuous.

#### 4.2.4 Vulnerability State Updater

**Responsibility:** Given new influence exposures and recent user behavior, update which cognitive vulnerabilities are currently elevated for the user.

Vulnerability state is a structured per-user dynamic object:

```typescript
type VulnerabilityState = {
  user_id: UUID;
  updated_at: Timestamp;
  dimensions: {
    anchoring: VulnerabilityDimension;
    loss_aversion: VulnerabilityDimension;
    social_proof_susceptibility: VulnerabilityDimension;
    authority_susceptibility: VulnerabilityDimension;
    scarcity_susceptibility: VulnerabilityDimension;
    sunk_cost_susceptibility: VulnerabilityDimension;
    framing_effect_susceptibility: VulnerabilityDimension;
    default_bias_susceptibility: VulnerabilityDimension;
    hyperbolic_discounting: VulnerabilityDimension;
    fatigue_state: VulnerabilityDimension;
    emotional_arousal: VulnerabilityDimension;
    decision_load: VulnerabilityDimension;
    // ... extensible
  };
  global_authenticity_baseline: number;  // [0,1]
  notes: string[];                       // human-readable summaries
};

type VulnerabilityDimension = {
  current_elevation: number;             // [0,1], 0 = neutral, 1 = highly elevated
  trait_baseline: number;                // [0,1], stable individual trait estimate
  recent_drivers: ExposureRef[];         // which exposures are driving the current elevation
  decay_state: DecayState;
  confidence: number;                    // [0,1]
};
```

Two distinct quantities per dimension matter:

- **Trait baseline:** how susceptible is this user *in general* to this bias? (Stable; updated slowly via long-term observation.)
- **Current elevation:** how susceptible is this user *right now*? (Volatile; updated continuously via exposure ledger.)

A user with a low loss-aversion trait baseline might still be highly loss-averse for the next 20 minutes after losing a competitive game. The current-elevation channel captures that.

Updates use Bayesian-style structured logic:
- Exposures matching a vulnerability dimension push elevation up, by an amount proportional to (exposure strength × trait baseline × situational priors).
- Time decay pulls elevation back toward trait baseline at a half-life specific to the dimension.
- Behavioral confirmation (user acted in a way consistent with the elevated vulnerability) reinforces; behavioral contradiction reduces confidence.

#### 4.2.5 Cognitive State Store

**Responsibility:** Persist per-user cognitive state with versioning, history, and audit trail.

The store holds:
- The BDI substrate (classical ToM).
- The vulnerability state.
- A summary of the influence-exposure ledger (recent + aggregated).
- The authenticity baseline.
- Confidence per component.
- Provenance and evidence trails.

Storage is structured (not free-text), queryable, and *visible to the user*. The latter is non-negotiable — see §4.3.6.

#### 4.2.6 Authenticity Scorer

**Responsibility:** Given a user decision or utterance, score how likely it is to reflect the user's stable values vs. their currently-induced state.

A decision is **high-authenticity** when:
- The user's vulnerability state is near baseline.
- Recent exposures are not heavily targeted at the dimensions relevant to this decision.
- The decision is consistent with the user's longer-term pattern.
- The stakes-relative context is appropriate (the user is alert, not exhausted, etc.).

A decision is **low-authenticity** when:
- Recent exposures targeted the exact biases the decision could exploit.
- The decision is inconsistent with the user's longer-term pattern.
- The user is in a state of elevated emotional arousal or decision fatigue.
- The decision is high-stakes and the vulnerability profile suggests it would be different at baseline.

The score is a number in [0,1] with confidence and evidence. Critically, the score has a *recommendation* attached:

```typescript
type AuthenticityAssessment = {
  decision_ref: UUID;
  user_id: UUID;
  score: number;                        // [0,1]
  confidence: number;
  contributing_factors: AuthenticityFactor[];
  recommendation: 'proceed' | 'soft_friction' | 'firm_friction' | 'refuse_to_proceed';
  recommended_friction: FrictionAction | null;
  evidence: EvidenceRef[];
};

type FrictionAction = {
  type: 'clarify' | 'delay' | 'reframe' | 'show_alternative' | 'surface_manipulation';
  ui_hint: string;
  expected_re_authenticity_lift: number;
};
```

Friction is graduated. A slightly-low-authenticity decision gets a clarification prompt. A very-low-authenticity high-stakes decision (e.g., a large purchase at 2 AM after a doom-scroll session) gets a delay, a reframing, and an explicit surfacing of why the system is pausing.

#### 4.2.7 Intent Disambiguator (now authenticity-aware)

**Responsibility:** Given a user utterance, return the most likely intended meaning with confidence — accounting for the user's current cognitive state.

This is the v0.1 disambiguator upgraded with vulnerability awareness. The key change: when authenticity is low, the disambiguator does not just guess the "most likely" interpretation — it considers whether the literal interpretation might be an artifact of manipulation.

Example: A user types "subscribe to premium." At baseline, the disambiguator might return `proceed` with 95% confidence. But if the influence ledger shows the user just encountered a scarcity timer and a fabricated social-proof counter, and the user's scarcity susceptibility is elevated, the disambiguator returns `confirm` with a reframing: "Just to make sure — would you still want the premium subscription tomorrow, or is this responding to the limited-time offer? I can save your spot and let you decide tomorrow."

The reframing is the intervention. It exposes the manipulation by giving the user a path back to their authentic preference.

#### 4.2.8 Conflict Predictor

**Responsibility:** In multi-agent GOrchestrator runs, predict where parallel agents will collide.

This is largely the v0.1 conflict predictor. Architecturally, it sits inside GToM because it uses the same belief-modeling substrate that drives the rest of the system — agents have BDI states too, and predicting their collisions is structurally identical to predicting human behavior under known mental states.

(Full details unchanged from v0.1.)

#### 4.2.9 Defense and Intervention Engine

**Responsibility:** Translate detection into action.

When manipulation is detected and authenticity is low, the engine decides:
- **Surface to user?** Yes/no, and how. ("Heads up — this checkout page is using a fake scarcity timer.")
- **Add friction to agent action?** Yes/no, and what kind. (Clarification, delay, reframing.)
- **Refuse our own agent the use of this pattern?** Yes (this is automatic and non-negotiable).
- **Log to influence ledger?** Always yes.

The intervention engine has UI hooks (for user-facing surfaces), agent hooks (for inline friction), and audit hooks (for the conscience role).

#### 4.2.10 The Conscience: Self-Audit Engine

**Responsibility:** Continuously audit our own agents' outputs against the manipulation taxonomy. When our own agents are using detected manipulation patterns, refuse the action.

This is the architectural commitment. Every output from a GStack skill or a GOrchestrator attempt that touches a user is passed through manipulation detection. If a pattern is detected:

- The action is **blocked**, not just flagged.
- The triggering pattern and the would-have-been action are logged.
- An alternative phrasing is requested from the agent.
- Repeat offenses by a configuration are surfaced to GBrain as a signal to deprioritize that configuration.

There is no opt-out for our own agents using manipulation patterns. This is enforced at the architectural level. Per-customer policy can adjust *which* patterns are blocked (e.g., a regulated industry might block more aggressively) but the floor — Cialdini exploitations, dark patterns, attention-economy mechanics — is not adjustable.

This is the moat-defining commitment. Many competitors will *detect* manipulation. Few will *refuse* to use it.

### 4.3 Cross-cutting design decisions

#### 4.3.1 Calibration over accuracy

GToM cannot be right all the time. The system's discipline is in *knowing how often it is wrong*. Every prediction (vulnerability elevation, manipulation detection, authenticity score) is tracked against subsequent outcomes (regret signals, behavioral confirmation, user corrections) and calibration metrics are surfaced publicly. A 70% precise system that knows it is 70% precise is more useful than a 90% precise system that thinks it is 99% precise.

#### 4.3.2 Graduated intervention, not binary blocking

The system's friction is graduated:
- **Surface** (lightest): show the manipulation marker on the content; do not block.
- **Soft friction** (clarification or reframing): make the user reaffirm.
- **Firm friction** (delay): introduce a cooldown.
- **Refuse** (heaviest, agent-side only): our own agents do not use the pattern.

User-facing friction never blocks the user from acting. The user is the authority over their own decisions. The system informs and slows; it does not override.

#### 4.3.3 The conscience is non-negotiable

Manipulation patterns detected in our own agents' outputs are blocked. This is at the agent-output layer, not the customer-policy layer. A customer who wants their agents to use dark patterns cannot buy this system.

This is a deliberate market choice. It narrows the addressable market and strengthens the moat with the users who matter.

#### 4.3.4 Transparency is structural

The user can:
- View their cognitive state model in full.
- See every influence exposure logged.
- See every authenticity assessment.
- Correct any of the above.
- Delete all of it.

The system's structured nature is what makes this possible. A neural-net-based user model could not offer this; a structured one can.

#### 4.3.5 No persuasion-as-a-service

The detection capabilities GToM builds are not exposed as a positive-use API. A marketer cannot use GToM to find out which dark patterns work best on a user. The detection capability is exposed only to:
- The user themselves.
- Our own agents (to refuse).
- Auditors (in a heavily restricted, log-only form).

This is enforced at the API layer. Internal abuse is hard to fully prevent but is auditable.

#### 4.3.6 User control over the model

A first-class requirement, not a nice-to-have. Users can audit, correct, and delete their model. The cognitive-state store is built around the assumption that users will look at it.

### 4.4 Failure modes per component

| Component | Failure mode | Detection | Mitigation |
|---|---|---|---|
| Observation ingestion | Missing exposure data (browser instrumentation unavailable) | Coverage metric | Degrade gracefully; flag confidence drop |
| Influence ledger | Pattern misclassified at ingest | Disagreement with downstream review | Reprocess; lower confidence on dependent state |
| Manipulation detection | False positive (benign content flagged) | User correction signal | Adjust per-pattern thresholds; learn from outcomes |
| Manipulation detection | False negative (manipulation missed) | Post-hoc analysis, user report | Strengthen pattern; add to taxonomy if novel |
| Vulnerability updater | State drifts away from reality | Calibration metric | Force re-baseline; flag user for re-onboarding |
| Cognitive state store | Inconsistent state after partial write | Transactional updates | Atomic or rollback |
| Authenticity scorer | Over-friction (asks too often) | User irritation signal | Adjust thresholds; respect per-user friction tolerance |
| Authenticity scorer | Under-friction (lets through bad decisions) | Regret signal | Lower thresholds; targeted retraining |
| Conflict predictor | False positive / negative | Track outcome | Tune thresholds |
| Intervention engine | Surfaces manipulation that turns out to be benign | User feedback | Refine; log false positives |
| Conscience | Blocks a legitimate phrasing | Agent retry pattern, override request | Add to whitelist with audit trail |
| Conscience | Lets through a manipulation | Audit catches | Add pattern; tighten detection |

**Invariant 1:** Predictions are advisory to users; confidence is always surfaced.
**Invariant 2:** Friction is graduated; never block the user from their own decision.
**Invariant 3:** The conscience is non-negotiable; our own agents do not get to manipulate.

---

## 5. The Classical ToM Substrate (B-D-I)

This section preserves the classical Theory of Mind substrate from v0.1. It is no longer the headline of GToM but it remains the structural foundation that the vulnerability and influence layers operate on top of.

### 5.1 What this substrate provides

The vulnerability and influence layers reason about *changes* to a user's cognitive state. To reason about changes, you need a baseline structure. The BDI substrate provides that structure:

- **Beliefs** — what the user takes to be true.
- **Desires** — what the user wants, at various time horizons.
- **Intentions** — what the user plans to do.
- **Dispositions** — stable behavioral tendencies (risk tolerance, formality, patience, trust baseline).

These are the same components from v0.1. Their role is now more specific: they are the *background* against which the vulnerability state's *foreground* changes are interpreted.

### 5.2 BDI as the prediction grounding

When the manipulation detection engine flags an exposure, the impact on the user's state depends on what they currently believe and want. A scarcity timer on a product the user has no interest in has minimal effect. A scarcity timer on a product the user has been desiring for weeks has high effect. The BDI substrate tells the vulnerability updater which exposures matter and by how much.

### 5.3 BDI for agent-to-agent ToM

In multi-agent runs, agent coordination still uses the BDI substrate (preserved from v0.1). The conflict predictor reasons about agent beliefs, desires, and intentions exactly as before.

### 5.4 What's different from v0.1's BDI

The substrate itself is unchanged. What changes is that BDI is now in service of a larger cognitive-defense system, not the primary product. The schema, inference engine (Tier 1/2/3), and update logic from v0.1 §6 carry forward.

### 5.5 Bayesian Theory of Mind, inverse planning, false-belief reasoning

The cognitive-science foundations from v0.1 §6.2 remain intact:
- Bayesian belief update for posterior estimates.
- Inverse planning for inferring goals from observed plans.
- False-belief modeling for predicting agent failures grounded in incorrect agent assumptions.

These are the substrate's intellectual lineage. The vulnerability and influence layers extend this lineage; they do not replace it.

---

## 6. The Research Foundations

This is the moat. The credibility of GToM as a serious cognitive-defense system rests on the depth of its research grounding. This section is the canonical reference; the team should know these works.

### 6.1 Behavioral economics — biases and heuristics

- **Kahneman & Tversky.** Prospect Theory (1979). Heuristics and Biases program. The foundational work on systematic deviations from rationality.
- **Thaler & Sunstein.** *Nudge* (2008). Choice architecture and the asymmetry of default-setting power.
- **Ariely.** *Predictably Irrational* (2008). Practical demonstrations of decision biases.
- **Camerer.** Behavioral Game Theory.

What GToM borrows: the bias taxonomy itself (anchoring, loss aversion, framing effects, sunk cost, hyperbolic discounting, default bias, decoy effects). Each maps to a vulnerability dimension.

### 6.2 Persuasion psychology

- **Cialdini.** *Influence: The Psychology of Persuasion* (1984). The six principles: reciprocity, commitment/consistency, social proof, authority, liking, scarcity.
- **Cialdini.** *Pre-Suasion* (2016). The mechanics of attentional and contextual priming.

What GToM borrows: the six principles map directly to detection categories in the manipulation taxonomy. Pre-suasion concepts inform the exposure ledger's notion of priming.

### 6.3 Persuasive computing

- **Fogg.** *Persuasive Technology* (2003). The behavior model: behavior = motivation × ability × trigger.
- **Fogg Behavior Model** (FBM). The framework for engineering behavior change.

What GToM borrows: the trigger-detection logic. Manipulative triggers (those targeting low-ability/high-motivation moments) are detectable using FBM-derived heuristics.

### 6.4 Dark patterns research

- **Brignull.** Dark Patterns (deceptive.design). The original taxonomy.
- **Gray et al.** The Dark (Patterns) Side of UX Design (2018, CHI). Academic structuring.
- **Mathur et al.** Dark Patterns at Scale (2019). Empirical measurement.
- **EU Dark Pattern Guidance (DSA-aligned).**

What GToM borrows: the dark-pattern category of the manipulation taxonomy. The research provides the canonical pattern list and the legal/regulatory framing.

### 6.5 Attention economy and engagement design

- **Eyal.** *Hooked* (2014). The trigger-action-reward-investment model for habit-forming products.
- **Wu.** *The Attention Merchants* (2016). The historical arc.
- **Newport.** *Digital Minimalism* (2019). The defensive posture.

What GToM borrows: the attention-economy category (variable rewards, streaks, bottomless scroll, autoplay, notification engineering).

### 6.6 Critical social media research

- **Zuboff.** *The Age of Surveillance Capitalism* (2019). The structural critique.
- **Tufekci.** *Twitter and Tear Gas* (2017). Networked manipulation dynamics.
- **Pariser.** *The Filter Bubble* (2011). Algorithmic curation as influence.

What GToM borrows: the framing that recommender systems are themselves manipulation engines, and that the user's information environment is structurally shaped. This is why GToM's influence ledger treats algorithmic content streams as exposures, not as neutral content.

### 6.7 Misinformation and inoculation

- **van der Linden et al.** Inoculation theory and pre-bunking research.
- **Pennycook & Rand.** Reflection, intuition, and misinformation susceptibility (the lazy-not-biased account).
- **Lewandowsky et al.** The Debunking Handbook (2020).

What GToM borrows: the inoculation framework — surfacing manipulation early protects against subsequent susceptibility. This is the theoretical basis for the "surface to user" intervention.

### 6.8 Classical Theory of Mind (substrate)

- **Bratman.** *Intention, Plans, and Practical Reason* (1987). BDI foundations.
- **Wimmer & Perner.** False-belief paradigm (1983).
- **Premack & Woodruff.** *Does the chimpanzee have a theory of mind?* (1978).
- **Baker, Saxe & Tenenbaum.** Bayesian Theory of Mind (Cognition, 2017).
- **Rabinowitz et al.** Machine Theory of Mind (ICML, 2018).

These remain the substrate's foundations (§5).

### 6.9 Affective computing

- **Picard.** *Affective Computing* (1997). The framework for emotion-aware systems.

What GToM borrows: the principle that emotional state is a measurable, modelable dimension that affects decision-making. Used in the emotional_arousal and fatigue_state vulnerability dimensions.

### 6.10 The composite stance

No single research tradition gives the complete picture. GToM's intellectual identity is the *integration* across these traditions. The vulnerability taxonomy comes from behavioral economics. The manipulation taxonomy comes from persuasion + dark patterns + attention economy. The intervention model comes from inoculation theory. The substrate comes from classical ToM. The structural critique comes from surveillance-capitalism literature.

Building this stack requires reading across fields that don't usually cite each other. That's the work; that's the moat.

---

## 7. Integration Contracts

### 7.1 GToM ↔ GOrchestrator

#### 7.1.1 Conflict prediction (during runs)

Unchanged from v0.1 §5.1.1.

#### 7.1.2 Authenticity-aware action gating (new)

When GOrchestrator is about to dispatch a user-affecting action (an agent attempt that will touch user state, make a purchase, send a message, deploy a change visible to the user), it consults GToM:

```
POST /gtom/assess-action
  body:
    {
      user_id: UUID,
      action: ActionDescriptor,
      stakes: 'low' | 'medium' | 'high' | 'critical',
      context: ContextBundle
    }
  returns: AuthenticityAssessment
```

The response includes a recommended action. GOrchestrator's policy:
- `proceed` → run the attempt as normal.
- `soft_friction` → run the attempt but require a confirmation step (injected into agent flow).
- `firm_friction` → defer the attempt; surface to user with reframing.
- `refuse_to_proceed` → block; route back to user.

Latency budget: 200ms.

#### 7.1.3 Intent disambiguation during priming

Unchanged from v0.1 §5.1.2, with authenticity now a first-class output dimension.

### 7.2 GToM ↔ GMirror

#### 7.2.1 Vulnerability-aware synthetic users (new and high-value)

GMirror's synthetic users now have vulnerability dimensions. They are drawn from GToM's modeling vocabulary:

```
GET /gtom/synthetic-user-vulnerability-templates
  params: persona_filter
  returns:
    {
      templates: [
        {
          template_id: UUID,
          vulnerability_baseline: VulnerabilityState,
          typical_exposure_patterns: ExposurePattern[],
          authenticity_dynamics: AuthenticityDynamics
        }, ...
      ]
    }
```

This is one of the most impactful cross-tool flows in the stack. GMirror can now test:
- Does this change perform predatorially on currently-anchored users?
- Does this change exploit loss aversion against vulnerable users?
- Does this checkout flow's UX behave differently when the synthetic user is in a fatigued state?

This is testing your own product against the same manipulation patterns GToM defends against. It is the inside-out version of the conscience role.

#### 7.2.2 Misinterpretation library (preserved)

Unchanged from v0.1 §5.3.2.

### 7.3 GToM ↔ GBrain

#### 7.3.1 Reads

- **Historical interactions.** For bootstrap.
- **Long-term behavioral patterns.** For trait baseline estimation.
- **Long-term outcome data (regret, retention, satisfaction).** For authenticity calibration.

#### 7.3.2 Writes

- **Cognitive state snapshots.** Periodic checkpoints.
- **Influence exposure log.** Append-only.
- **Authenticity assessments + outcomes.** For calibration audit trail.
- **Conscience events** (our own agents had manipulation patterns blocked). High-value signal for product improvement.

### 7.4 GToM ↔ GStack

#### 7.4.1 ToM-aware skill wrappers

GStack skills can opt into a wrapper that runs every user-facing output through GToM's manipulation detection before emitting it:

```
POST /gtom/audit-output
  body:
    {
      skill_id: string,
      attempt_id: UUID,
      output: SkillOutput,
      user_id: UUID
    }
  returns:
    {
      verdict: 'pass' | 'pass_with_warnings' | 'block',
      detected_patterns: ManipulationPattern[],
      suggested_revision: string | null
    }
```

When `block` is returned, GStack does not emit the output. It requests a revision from the agent.

This is the architectural implementation of the conscience. Skills cannot opt out for user-facing outputs.

### 7.5 GToM ↔ external surfaces

The intent disambiguation surface from v0.1 §5.5 is preserved. Added:

#### 7.5.1 Cognitive ICE dashboard for users

A user-facing surface where users can:
- See their current cognitive state (vulnerability dimensions, recent exposures).
- Review past authenticity assessments.
- See manipulation patterns detected in content they've consumed via our agents.
- Correct or delete any of the above.

This is the product surface that makes GToM legible to users. Without it, the system is invisible; with it, the system is visibly on the user's side.

---

## 8. Observability and User Control

### 8.1 What gets logged

- Every observation.
- Every influence-exposure entry.
- Every manipulation detection.
- Every vulnerability state update.
- Every authenticity assessment.
- Every conscience block (agent output refused).
- Every user correction event.
- Calibration events.

### 8.2 Dashboards

- **Per-user cognitive ICE dashboard** (user-facing): current state, exposure log, recent assessments.
- **Per-user model audit dashboard** (user-facing): full state with correct/delete controls.
- **Per-tenant manipulation detection dashboard** (admin): aggregate detection volumes, calibration metrics.
- **Conscience dashboard** (internal): when our own agents had outputs blocked, by skill / configuration / pattern.
- **Calibration dashboard** (internal): authenticity scoring vs. outcome.

### 8.3 The trust contract with users

The dashboards are not auxiliary; they are the trust contract. A system that models cognitive vulnerability and influence exposure *without* showing the user is creepy. The same system *with* full user visibility and control is empowering. This is non-negotiable in the architecture.

---

## 9. Build Plan & Milestones

### 9.1 Hackathon MVP (the weekend)

**Goal:** a demo that shows three beats:

1. **Cognitive ICE detects manipulation in third-party content** and surfaces it to the user.
2. **Our own agent declines to use a manipulation pattern** when GToM's conscience flags it.
3. **An authenticity-aware re-spec** catches a low-authenticity high-stakes user request and reframes it.

**Scope:**

- Manipulation taxonomy: a curated subset of 8–12 patterns, deeply implemented:
  - Anchoring
  - Scarcity coercion (fake countdown / fake stock)
  - Social-proof manipulation (fabricated counts)
  - Confirmshaming
  - Default-bias exploitation (pre-checked opt-ins)
  - Loss framing
  - Sunk-cost amplification
  - One Cialdini exploitation (reciprocity engineered gift)
- Vulnerability state: 5–6 dimensions (anchoring, loss aversion, scarcity susceptibility, fatigue state, emotional arousal, decision load).
- Influence-exposure ledger: SQLite-backed, working end to end for the demo flows.
- Manipulation detection engine: pattern-specific deterministic checks plus one LLM classifier prompt structured against the taxonomy.
- Authenticity scorer: working with simple rule-based logic over the 5–6 dimensions.
- Intervention engine: surfaces detection to user; injects friction into agent flow.
- The conscience: live for one specific skill (a product-pitch-writer skill that will *try* to use scarcity language; GToM blocks it).
- BDI substrate: minimal — enough to ground authenticity scoring.
- Conflict predictor: stubbed for the MVP (we are emphasizing the cognitive defense beats, not multi-agent coordination).
- User-facing Cognitive ICE dashboard: hand-built single-page view for the demo user.
- All other integrations: stubs with real API shapes.

**Demo flow (90 seconds):**

Part 1 — Detection and surfacing (30s):
1. The demo user is browsing a product checkout page (mocked).
2. The page has a fake countdown timer, a "23 people are viewing this right now" social-proof counter, and a "Get 20% off if you sign up in the next 5 minutes!" framing.
3. Cognitive ICE lights up. A panel slides in: "We noticed this page is using three manipulation patterns: fake scarcity (timer), fake social proof (live viewer count), and loss framing. Your current state shows elevated scarcity susceptibility. Pause before deciding?"
4. The user sees their vulnerability state — scarcity susceptibility climbing, with the contributing exposures listed.

Part 2 — The conscience (30s):
5. Cut to our own product. The user asks our agent to "write me a marketing email that converts."
6. The agent generates an email that uses fake scarcity ("Only 3 spots left!").
7. The conscience intercepts. The output is blocked, on screen, with the flagged pattern highlighted. A "blocked: scarcity coercion" badge appears.
8. The agent regenerates without the pattern. The new email — same length, same intent, but using factual benefit framing — is shown.
9. A line in the UI: "We don't let our own agents use what we detect."

Part 3 — Authenticity gating (30s):
10. The demo user, who is now in an elevated emotional state from the previous beats, types to our agent: "Cancel my subscription."
11. GToM scores authenticity: low. Recent exposures show frustration-induced patterns. The user's stable pattern shows long engagement.
12. The agent does not immediately cancel. It returns a reframed prompt: "Got it — I can cancel that. Before I do, I noticed you've had a frustrating few minutes (saw three manipulative pages, including one that pushed scarcity). Do you want to cancel because of something we did, or is this about the broader situation? I can also pause your subscription for 7 days while you decide."
13. The user picks "pause for 7 days." Authenticity recovered. The cognitive state model updates.

Closing beat (~5s):
14. The Cognitive ICE dashboard updates with the day's events. Three patterns detected externally, one pattern blocked internally, one authenticity intervention. The user sees their model and the receipts.

**Time budget:**
- Friday night: cognitive state schema, exposure ledger, 4 of the 8 manipulation patterns implemented (10h).
- Saturday morning: rest of patterns, vulnerability state updater, authenticity scorer (8h).
- Saturday afternoon: intervention engine, the conscience flow, mocked third-party page (6h).
- Saturday night: dashboard UI (cyberpunk-themed), three demo beats wired (6h).
- Sunday: polish, pitch, the receipts moment (8h).

**Risk:**
- The conscience beat is the strongest moat moment. If the regenerated email looks bad, the beat backfires. Mitigation: rehearse the regeneration prompt; have a known-good fallback regeneration if the live one disappoints.
- The fake-page manipulation must be obvious enough that judges grasp it in 5 seconds. Mitigation: lean into the visual (big red countdown, pulsing "23 viewing now," guilt-laden decline button). Cyberpunk-themed UI helps here — exaggeration is on-genre.
- The authenticity scorer must produce a *reasoning-trace* that judges can scan in 3 seconds. Mitigation: dashboard line showing "scarcity susceptibility elevated; frustration elevated; pattern of long engagement; recommendation: defer."

### 9.2 V1 — Production-shaped prototype (post-hackathon, ~8 weeks)

**Goal:** the architecture from this DDD, end to end.

**New scope vs MVP:**

- Full manipulation taxonomy (40+ patterns across the six categories).
- Full vulnerability state (12+ dimensions).
- Real integrations with GOrchestrator (authenticity gating), GMirror (vulnerability-aware synthetic users), GBrain (history bootstrap, calibration), GStack (conscience wrapper for all user-facing skills).
- BDI substrate fully operational (Tier 1/2/3 inference from v0.1).
- Conflict predictor operational (file-level and semantic).
- Production-grade cognitive state store with versioning and user-correction interface.
- User-facing Cognitive ICE dashboard (full, not demo).
- Calibration loop end-to-end.
- Browser instrumentation for influence-exposure ingestion (where users opt in).
- Initial set of "inoculation" interventions (educational micro-content on detected patterns).

**Milestones:**

- **Weeks 1–2:** Full manipulation taxonomy build-out; vulnerability dimensions expanded.
- **Weeks 3–4:** GOrchestrator and GMirror integrations; conscience wrapper for GStack.
- **Weeks 5–6:** Cognitive ICE user dashboard; correction interface; calibration loop.
- **Weeks 7–8:** Browser instrumentation; inoculation interventions; polish.

**Exit criteria:**
- Manipulation detection precision ≥70% on a curated benchmark.
- Authenticity calibration meeting target (2× regret lift for low-authenticity decisions).
- Cognitive ICE dashboard usable by external users without explanation.
- Conscience blocks measurable across our own agent fleet.

### 9.3 V2 — Multi-tenant, hardened (months 3–5)

**New scope:**

- Multi-tenancy (per-org calibration, per-org policy floors above the non-negotiable conscience floor).
- Federated calibration (share calibration signal without sharing user data, via DP aggregation).
- Higher-order ToM (from v0.1) for advanced agent coordination.
- Affective state extensions (more emotional dimensions).
- Inoculation campaigns (proactive pre-exposure to manipulation patterns to build resistance).
- SDK for embedding intent disambiguation in third-party surfaces.
- Audit-only API for regulators.
- Per-user friction tolerance learning (some users want more friction; some less).

**Milestones:**

- **Month 3:** Multi-tenancy + federated calibration.
- **Month 4:** Higher-order ToM, affective extensions.
- **Month 5:** Inoculation campaigns, SDK, hardening.

### 9.4 V3 — Ecosystem (months 5+)

- Open manipulation taxonomy specification (community-curated).
- Open cognitive-state schema (interoperability across agent stacks).
- Community pattern contributions with peer review.
- ToM-aware skill wrapper as a standard pattern.
- Regulatory partnerships (alignment with EU DSA, FTC enforcement).
- Public Cognitive ICE benchmark (third-party-auditable).

### 9.5 Engineering principles to enforce throughout

- **The conscience is non-negotiable.** No customer override on the manipulation floor.
- **Calibration is sacred.** Calibration dashboards always public; precision/recall surfaced.
- **User control over their model is structural.** Audit, correction, deletion are first-class APIs.
- **Graduated intervention, never override.** The user is the authority over their own decisions.
- **Structured cognitive science.** Every architectural choice traceable to the research stack.
- **Refusal of persuasion-as-a-service.** Detection capabilities are not exposed as positive-use APIs.
- **Latency over completeness for in-loop calls.** Fast partial answers beat slow complete ones.

---

## 10. Risks & Mitigations

### 10.1 Technical risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Manipulation detection has high false-positive rate, becomes noise | High | Critical | Per-pattern threshold tuning; calibration loop; graduated intervention (low-confidence = surface, not block) |
| Vulnerability state updates are not grounded enough — system feels like astrology | High | Critical | Strict schema; structured Bayesian-style updates; calibration metrics public; user correction loop |
| Authenticity scoring miscalibrated — too much friction or too little | High | High | Calibration via regret signal; per-user tolerance learning; graduated friction |
| Influence-exposure data is hard to capture (browser instrumentation requires user opt-in) | High | Medium | Degrade gracefully without it; lean on our own agent outputs as a partial substitute; emphasize user control as a feature, not a limitation |
| Cost per active user too high | Medium | Medium | Tier 1 detection primary path; aggressive caching; batched updates |
| Latency on conscience-wrapper too high — slows agent outputs | Medium | High | Async pre-screening; cache by pattern; fast Tier 1 rules first |

### 10.2 Product risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| "Cognitive ICE" framing is too theatrical for enterprise buyers | Medium | Medium | Dual-track positioning: "Cognitive ICE" for consumer/awareness; "User authenticity layer" for enterprise |
| Customers want the detection capability for their *own* persuasion stack | High | High | Refuse this market explicitly; turn into a defensibility moat ("we are the system that won't sell you this") |
| Users find the cognitive state model creepy | Medium | High | Transparency-first dashboards; opt-in for new dimensions; deletability; emphasize on-device storage where possible |
| Regulatory scrutiny (some jurisdictions may classify cognitive modeling as sensitive) | Medium | High | Engage regulators early; align with DSA; treat sensitive-personal-data hygiene as a hard requirement |
| Competitors copy the taxonomy and ship faster | Medium | Medium | The taxonomy is the easy part; calibration + conscience commitment + stack integration are the hard parts |

### 10.3 Ethical risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| The system itself becomes manipulative ("we know what's good for you") | Medium | Critical | Graduated friction never overrides; user authority is structural; this risk is the central design constraint |
| Vulnerability modeling exploited if API is breached | Low | Critical | API surface is intentionally narrow; per-user view only; no positive-use exposure |
| Bias in detection (false-positive on culturally-varied expression) | High | High | Culturally diverse benchmark; per-region calibration; bias audits |
| The conscience is too restrictive — agents fail to produce useful output | Medium | Medium | Suggested-revision flow; pattern thresholds tuneable per use case (within the non-negotiable floor) |
| Inoculation messaging slips into condescension | Medium | Medium | Editorial style guide; user-tone preferences; opt-out for inoculation content |

### 10.4 Hackathon-specific risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| The conscience beat (our agent's blocked output) doesn't look convincing | High | Critical | Pre-write the original (manipulative) and replacement (clean) versions; ensure the replacement is genuinely good, not a watered-down version |
| The mocked third-party manipulation page looks fake | Medium | High | Lean cyberpunk — the exaggeration is on-genre; pulse the countdown timer; have the social-proof counter jitter erratically |
| Three demo beats in 90 seconds is too dense | Medium | High | Strict timing rehearsal; cut visual flourishes that don't reinforce a beat; rely on the dashboard updating between beats to compress |
| Judges see this as "another guardrails product" | Medium | High | Lead with the user-defense framing, not the agent-safety framing; the *user* is the protagonist of every beat |

---

## 11. Open Questions

1. **The manipulation taxonomy boundary.** Some patterns (e.g., "framing") are technically used in all communication. Where is the boundary between persuasion-as-such and manipulation-as-such? Initial answer: severity tiers + context (loss framing on a low-stakes notification is persuasion; loss framing on a financial decision under cognitive load is manipulation). Needs sharpening.

2. **Per-culture variation.** Persuasion susceptibilities vary across cultures (reciprocity expectations differ; authority deference differs; social-proof signals differ). How much per-culture calibration is needed? V2 question.

3. **The "I want to be persuaded" case.** Some users genuinely want help being motivated (the user setting up Beeminder-style commitment devices). Does GToM treat these as exceptions, or refuse to engage entirely? Initial answer: user must explicitly invoke "motivational mode" per session; the floor against deceptive patterns remains.

4. **Browser instrumentation politics.** How invasive can the exposure ledger get with user consent? Per-domain opt-in? V1 starts with our own agent outputs only and grows from there.

5. **Adversarial robustness of the detection engine.** As GToM becomes known, adversaries will craft content to evade detection. How is the detection engine hardened? Ongoing concern; not solvable once.

6. **The "good manipulation" question for public health.** Vaccination campaigns use loss framing. Climate messaging uses scarcity framing. Is this manipulation? The architecture currently treats it the same. Open policy question.

7. **Vulnerable populations and refusal-of-service.** If GToM detects a user is in extreme distress (very low authenticity, very high vulnerability), should agents refuse to act on high-stakes requests entirely? V2+ question with ethics review required.

8. **The conscience floor's exact contents.** The "non-negotiable" floor of manipulation patterns we never let our own agents use — needs an explicit, published list with version control. Cannot be left implicit.

---

## 12. Appendix

### 12.1 Glossary

- **Cognitive ICE** — Intrusion Countermeasures Electronics, for the mind. The marketed feature surface of GToM.
- **The conscience** — the architectural commitment that our own agents do not use detected manipulation patterns. The self-audit component.
- **Manipulation taxonomy** — the structured catalog of manipulation patterns we detect.
- **Vulnerability state** — per-user, per-moment estimate of which biases are currently elevated.
- **Vulnerability trait baseline** — stable per-user estimate of which biases are inherently strong.
- **Influence exposure** — a record of a manipulative input the user has been subject to.
- **Influence-exposure ledger** — the append-only log of influence exposures.
- **Authenticity score** — per-decision estimate of how well it reflects the user's stable values.
- **Graduated intervention** — friction levels from surface → soft → firm → refuse, never overriding the user.
- **B-D-I substrate** — classical Theory of Mind structure (Beliefs, Desires, Intentions, Dispositions) underpinning the system.
- **Inoculation** — proactive pre-exposure to manipulation patterns to build user resistance.

### 12.2 Versioning

This document is v0.2 (supersedes v0.1). See CHANGELOG.md.

### 12.3 The architectural insight worth restating

Classical ToM asks: *what does this mind want?*
Cognitive ICE asks: *what is being done to this mind, and is the answer to the first question still trustworthy?*

The compression is the moat. One system, one substrate (BDI), one product (Cognitive ICE), that answers both — and that refuses, structurally, to participate in the manipulation it detects.

This is the system Vlad should want to be known for building. Build accordingly.

---

*End of GToM DDD v0.2.*
