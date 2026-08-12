# Vidscribe

Vidscribe turns recorded media into organized, searchable knowledge assets.

## Language

**Session**:
A bounded audio or video recording submitted for distillation, such as a meeting, lecture, interview, presentation, podcast, or voice memo.
_Avoid_: Meeting when referring to all recordings, job, upload

**Meeting**:
A Session involving participants whose conversation may contain decisions, action items, questions, and shared context.
_Avoid_: Session when specifically discussing meeting semantics

**Transcript**:
The complete spoken record of a Session with a timestamp at each speaker turn and explicit Silence Markers for meaningful extended pauses. Whisper provides word-level coverage and timestamps internally; Gemini receives that full baseline to correct names, terminology, punctuation, speakers, and structure without omitting or inventing speech. Long pauses do not end a Session.
_Avoid_: Summary, notes

**Silence Marker**:
A standalone transcript line derived from Whisper word timing for a pause of at least 10 seconds, formatted as `(Silence MM:SS)`. Gemini does not decide whether a shorter pause qualifies.
_Avoid_: Treating silence as the end of a Session, timestamp gap, model-estimated pause

**Speaker Label**:
The evidence-backed, Session-unique name used for a speaker throughout the Session Record. Renaming it updates every reference, and a rename cannot duplicate another Speaker Label; unsupported identities use stable numbered labels such as `Speaker 1` and `Speaker 2` until corrected during Final Review.
_Avoid_: Guessed identity, generic Unknown

**Session Record**:
The single canonical Markdown document produced for a Session. Its order is optional Input Context, Session Record Header, Recall Brief, optional Highlights, Action Summary or Topics, optional Chapters, Snapshots Section, then the complete Transcript as its final section; optional sections follow their Extraction Options.
_Avoid_: Session Brief, separate summary file, transcript file

**Session Record Header**:
The mandatory opening identity of a Session Record, formatted as `📝 **{title}** · {MM-DD-YYYY}` followed by one line of participant handles when participants are known. When Action Summary is selected, that copyable block repeats the header so it remains understandable when sent by itself.
_Avoid_: Metadata frontmatter, non-self-contained Action Summary

**Recall Brief**:
A compact, recording-grounded description of the unique circumstances that make a Session recognizable, such as who performed a particular pass, the specific scope reached, and the outcome or stopping point. It helps identify and recall the Session without merely restating Input Context or summarizing all knowledge within it.
_Avoid_: Overview, Action Summary, generic abstract, paraphrased Input Context

**Action Summary**:
A self-contained, copyable account of what mattered in a Session that repeats the Session Record Header and Recall Brief. It uses concrete headings derived from the content, includes owner-specific Next Steps only when genuine follow-up exists, and is mutually exclusive with Topics.
_Avoid_: Overview, fixed decisions section, forced action items

**Extra Instructions**:
Optional Session-specific guidance supplied during intake to supplement the default extraction and Action Summary rules. It may shape interpretation and presentation but cannot override Transcript completeness, evidence grounding, or filesystem safety.
_Avoid_: Per-session template editor, Attached Context, integrity override

**Chapter**:
A titled major segment of a Session formatted as a YouTube-compatible timestamp line, such as `00:00 Opening and context`. Chapters begin at `00:00`, appear in ascending order, contain at least three entries when emitted, and each spans at least 10 seconds.
_Avoid_: Topic, snapshot moment

**Topic**:
A subject discussed within a Session, independent of where or how long it appears.
_Avoid_: Chapter

**Topics**:
A descriptive, topic-organized extraction of a Session's themes and findings without operational framing or Next Steps. It is mutually exclusive with Action Summary.
_Avoid_: Keyword list, duplicate Action Summary

**Highlight**:
A timestamped moment worth revisiting, including a notable exchange, realization, event, or exact speaker-attributed quote. Exact quotes preserve the Transcript wording rather than paraphrasing it.
_Avoid_: Topic, Recall Brief, unsupported or decorative quote

**Snapshot**:
A named still image extracted from a video Session according to the active snapshot rules. Its timing is anchored to the exact Whisper word timestamps of the spoken cue selected by Gemini. Its filename uses a zero-padded sequence and concise descriptive subject, such as `01-lighting-before.jpg`.
_Avoid_: Screenshot, frame grab

**Snapshot Cue**:
The exact transcript phrase whose Whisper word timestamps anchor a Snapshot extraction. FFmpeg targets the selected word and may adjust by no more than 100 milliseconds.
_Avoid_: Approximate chapter timestamp, broad semantic moment

**Snapshot Rule**:
A Snapshot is created only when speech explicitly points to useful visible information, such as something on screen, a setting, diagram, comparison, or demonstrated state. Ordinary conversation, purely verbal insights, vague references, and duplicate views do not qualify.
_Avoid_: Automatic interval capture, talking-head capture

**Snapshots Section**:
The stable Session Record section listing Snapshot timestamps and filenames. For video it explicitly states when no Snapshot qualifies; for audio it explicitly states that the Source Media was audio.
_Avoid_: Forced minimum snapshots, omitted section

**Session Date**:
The date on which a Session was recorded. A valid date in the recording filename takes precedence, followed by reliable recording metadata; the user supplies or confirms it when neither is available.
_Avoid_: Processing date, upload date

**Session Purpose**:
The controlled term in a Session's Short Name that communicates the primary nature of the interaction, such as Sync, Working, Onboarding, Tutorial, Interview, or Dialogue.
_Avoid_: Type, arbitrary descriptive phrase

**Sync**:
A Session primarily spent discussing, reviewing, coordinating, or planning work.
_Avoid_: Review, Planning

**Working**:
A Session primarily spent actively doing the work together.
_Avoid_: Work Session, Workshop when no facilitated workshop format exists

**Onboarding**:
A Session primarily transferring the operational knowledge needed to participate in a role or project.
_Avoid_: Tutorial when the focus is a specific procedure or tool

**Tutorial**:
A Session primarily teaching a specific procedure or tool.
_Avoid_: Onboarding when the focus is broader role or project knowledge

**Interview**:
A Session primarily structured around questions led by one side.
_Avoid_: Dialogue

**Dialogue**:
A Session primarily exploring ideas without a predefined operational outcome.
_Avoid_: Interview, Sync

**Primary Subject**:
The project, system, topic, person, or group of people used as the main retrieval key in a Session's Short Name. People are named only when the Session is centered on them, not merely because they attended.
_Avoid_: Automatic participant list, attendee list

**Short Name**:
The systematic human-readable name proposed after analyzing the complete Session and its Attached Context. It combines the Primary Subject, Session Purpose, optional sequence, and optional `[Dense]` marker, and must be confirmed or edited during Final Review.
_Avoid_: Pre-processing title, raw recording name

**Session Identity**:
The authoritative Session Date, Short Name, optional `[Dense]` marker, and Speaker Labels confirmed during Final Review. Changes propagate to every repeated reference and proposed completed asset name rather than being inferred from edited Markdown.
_Avoid_: Parsed Markdown identity, divergent metadata, independently edited duplicate

**Dense**:
A naming marker for a Session containing several concrete explanations, procedures, mental models, or domain findings worth revisiting independently of immediate follow-up. Gemini may propose `[Dense]` at the end of the Short Name, but the user confirms it during Final Review; duration and generic importance do not qualify.
_Avoid_: [k], important, long

**Attached Context**:
User-supplied material that helps interpret a Session, including names, terminology, background, and supporting files. Supporting files are analysis inputs only and remain at their original locations.
_Avoid_: Prompt, miscellaneous attachments

**Input Context**:
The optional opening ledger containing Extra Instructions exactly as entered and the filenames of attachments consulted during analysis. It precedes the Session Record Header, is omitted when no Attached Context was provided, and never embeds attachment contents.
_Avoid_: AI-rewritten context, empty context section, copied attachment content

**Destination**:
The directory where a completed Session is stored, chosen through the macOS folder picker. Vidscribe remembers only the most recently selected Destination for the next intake; clicking the Destination control opens the picker to replace it.
_Avoid_: Destination Profile, saved Destination list, free-text path, Gemini-selected destination, category

**Extraction Options**:
The user-selected set of Action Summary or Topics, Chapters, and Highlights sections to include in a Session Record; Action Summary and Chapters are selected by default. Every selected option produces a stable section with an explicit empty result when no content qualifies, while unselected outputs do not appear; Recall Brief, Snapshots Section, and Transcript are not optional.
_Avoid_: Mode, profile, AI preference, silently omitted selected section

**Source Media**:
The single original audio or video file submitted for a Session. After successful output verification, it is moved from its intake location into the completed Session folder; failed processing leaves it untouched.
_Avoid_: Temporary media, external source reference

**Source Fingerprint**:
The content-derived identity retained for Source Media so an unfinished Session can restore valid cached Analysis Audio, Transcript, intake values, and Analysis Attempts after the file is reselected or renamed. When the Source Media belongs to a completed Session, it reconnects to the existing Session Record and Completed Session Folder readonly rather than silently creating a duplicate.
_Avoid_: Path-only identity, filename matching

**Analysis Audio**:
The mono Opus audio in an Ogg container derived once from Source Media at a 24 kbps bitrate, reused for both Whisper and Gemini, and retained in the Completed Session Folder as a durable archive asset. It shares the approved Session basename with the suffix `.24k.ogg`. Gemini also receives the complete Whisper Transcript, Session Date, Attached Context, Extraction Options, and output rules; Source video is not provided.
_Avoid_: Temporary analysis file, Source video input, audio-only transcript without Whisper baseline

**Analysis Result**:
The single structured response returned by Gemini for an Analysis Attempt, containing the streamed Session Record Markdown and machine-readable metadata required for naming, Speaker Labels, Snapshot extraction, and verification.
_Avoid_: Separate metadata request, parsing metadata from prose

**Analysis Attempt**:
An independent candidate analysis within a Session. Attempts share the Session's valid Analysis Audio and Whisper Transcript but own their Extra Instructions, Extraction Options, model, effort, Raw Analysis Stream, Analysis Result, edits, and Snapshot review choices. Separate browser tabs may create separate attempts for comparison; exactly one attempt may finalize the Session, after which the others become readonly.
_Avoid_: Separate Session, duplicate transcription, completed revision history, multiple commits

**Raw Analysis Stream**:
The incomplete structured Gemini response belonging to one Analysis Attempt, shown live during analysis and retained in private application storage for recovery and debugging. If Gemini fails during generation, the partial visible stream is preserved; inactive history is removed after 30 days, while active, Interrupted, and Needs Attention Sessions are exempt.
_Avoid_: Archived deliverable, final Session Record

**Session Intake**:
The Session workspace where the user chooses a Destination, supplies Attached Context, adjusts Extraction Options, and starts processing without navigating to another page. It remains focused on intake through media preparation and transcription, revealing the analysis and review surface only after Gemini begins the Raw Analysis Stream. Manual file intake is the only v1 intake path.
_Avoid_: Automatic processing, OBS-only workflow

**Final Review**:
The readable Analysis Result displayed in the same Session workspace after streaming completes and before filesystem finalization. The user may edit its Markdown and final identity, globally rename Speaker Labels, or keep or remove proposed Snapshots. Executing an existing Analysis Attempt again reuses valid Analysis Audio and Transcript while replacing that attempt's pending result; opening a separate tab may create another attempt for comparison. Exactly one attempt may finalize the Session, after which every other attempt becomes readonly.
_Avoid_: Separate review page, mandatory section-by-section approval, automatic finalization

**Session Marker**:
A deferred automation concept for letting a future OBS or Raycast integration claim one completed recording and open Session Intake. Session Markers, OBS intake, Raycast shortcuts, and login startup are outside v1; manual file intake is the only v1 intake path.
_Avoid_: Shared marker file, automatic classification, separate before-recording and during-recording flags

**Interrupted**:
A recoverable Session whose processing stopped because of a transient technical interruption. Its completed progress is retained so processing can resume.
_Avoid_: Failed, rejected

**Needs Attention**:
A recoverable Session that requires user input or correction before it can be finalized, including a Completed Session Folder name that already exists in the selected Destination.
_Avoid_: Failed, interrupted

**Rejected**:
A Session whose Source Media cannot be processed, such as unsupported or corrupt media. Its Source Media remains untouched and temporary processing data is removed.
_Avoid_: Interrupted, cancelled

**Cancelled**:
A Session the user intentionally stops. Temporary processing data is removed only after confirmation.
_Avoid_: Rejected, interrupted

**Completed Session Folder**:
The systematically named directory created inside the selected Destination. Its root contains the verified Session Record, Source Media, and any Snapshot files for exactly one Session. The folder, Session Record, and Source Media share the same approved Session Date and Short Name basename.
_Avoid_: Job folder, arbitrary meeting folder
