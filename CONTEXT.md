# Speech Distillation

Speech Distillation turns recorded media into organized, searchable knowledge assets.

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
A standalone transcript line representing a pause of at least 15 seconds as `(Silence MM:SS)`.
_Avoid_: Treating silence as the end of a Session, timestamp gap

**Speaker Label**:
The evidence-backed name used for a speaker in the Transcript. When identity is unsupported, stable numbered labels such as `Speaker 1` and `Speaker 2` are used and may be corrected during final review.
_Avoid_: Guessed identity, generic Unknown

**Session Record**:
The single canonical Markdown document produced for a Session, containing its date, title, selected extraction results, optional Context Section, relative Snapshot references, and the complete Transcript as its final section.
_Avoid_: Session Brief, separate summary file, transcript file

**Action Summary**:
A concise, topic-driven account of what mattered in a Session. It uses concrete headings derived from the content and includes owner-specific Next Steps only when genuine follow-up exists.
_Avoid_: Overview, fixed decisions section, forced action items

**Context & Instructions**:
The single intake field where the user supplies Session-specific context and guidance for interpreting the recording and shaping the output. It replaces separate context and extra-instruction fields so the user has one obvious place to explain what matters.
_Avoid_: Separate extra-instructions box, per-session template editor, Attached Context

**Chapter**:
A titled major segment of a Session formatted as a YouTube-compatible timestamp line, such as `00:00 Opening and context`. Chapters begin at `00:00`, appear in ascending order, contain at least three entries when emitted, and each spans at least 10 seconds.
_Avoid_: Topic, snapshot moment

**Topic**:
A subject discussed within a Session, independent of where or how long it appears.
_Avoid_: Chapter

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
The stable Session Record section listing Snapshot timestamps and filenames. It remains present with an explicit empty result when no Snapshot qualifies.
_Avoid_: Forced minimum snapshots, omitted section

**Recording Date**:
The date on which a Session was recorded. A valid date in the recording filename takes precedence, followed by reliable recording metadata; the user supplies or confirms it when neither is available.
_Avoid_: Processing date, upload date

**Local Start Time**:
The local clock time when a Session recording began, when it can be inferred from the recording filename or reliable metadata. It supports identity, ordering, and disambiguation but is not the same as the Recording Date.
_Avoid_: Processing time, upload time

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

**Dense**:
A naming marker for a Session containing several concrete explanations, procedures, mental models, or domain findings worth revisiting independently of immediate follow-up. Gemini may propose `[Dense]` at the end of the Short Name, but the user confirms it during Final Review; duration and generic importance do not qualify.
_Avoid_: [k], important, long

**Attached Context**:
User-supplied material that helps interpret a Session, including names, terminology, background, and supporting files. Supporting files are analysis inputs only and remain at their original locations.
_Avoid_: Prompt, miscellaneous attachments

**Context Section**:
The optional Session Record section containing user-supplied context text and the names of attachments consulted during analysis. It is omitted when no Attached Context was provided and never embeds attachment contents.
_Avoid_: Empty context section, copied attachment content

**Destination**:
A reusable, user-labeled directory reference where a completed Session is stored. One Destination is the default and is preselected during intake, while the user may choose another configured Destination.
_Avoid_: Destination Profile, Gemini-selected destination, category

**Template**:
A reusable extraction preset that defines the default Session Record shape, such as meeting-style summaries, chapters, transcript, snapshots, and structured naming. A Custom Template starts from the currently selected Template and appears when inherited options are changed for the current Session.
_Avoid_: Destination, Profile, blank custom mode

**Extraction Options**:
The user-selected set of information to include in a Session Record. Common meeting outputs are selected by default and can be changed for each Session.
_Avoid_: Mode, profile, fixed template

**Source Media**:
The single original audio or video file submitted for a Session. After successful output verification, it is moved from its intake location into the completed Session folder; failed processing leaves it untouched.
_Avoid_: Temporary media, external source reference

**Source Fingerprint**:
The content-derived identity stored for Source Media so valid cached Analysis Audio, transcription, intake values, and latest Analysis Result can be restored after the file is reselected or renamed.
_Avoid_: Path-only identity, filename matching

**Analysis Audio**:
The mono Opus audio in an Ogg container derived once from Source Media at a 24 kbps bitrate, reused for both Whisper and Gemini, and retained in the Completed Session Folder as a durable archive asset. It shares the approved Session basename with the suffix `.24k.ogg`. Gemini also receives the complete Whisper Transcript, Recording Date, Attached Context, Extraction Options, and output rules; Source video is not provided.
_Avoid_: Temporary analysis file, Source video input, audio-only transcript without Whisper baseline

**Analysis Result**:
The single structured response returned by Gemini containing the streamed Session Record Markdown and machine-readable metadata required for naming, Speaker Labels, Snapshot extraction, and verification.
_Avoid_: Separate metadata request, parsing metadata from prose

**Analysis Note**:
A short Gemini-facing status or observation displayed immediately before the generated Session Record during Final Review. It helps the user understand generation quality or caveats, but it is not included in the finalized Session Record.
_Avoid_: Final document section, hidden reasoning, chain-of-thought

**Raw Analysis Stream**:
The incomplete structured Gemini response shown live during analysis and retained in private application storage for recovery and debugging. Inactive history is removed after 30 days, while active, Interrupted, and Needs Attention Sessions are exempt.
_Avoid_: Archived deliverable, final Session Record

**Redo**:
A destructive new Analysis Result produced for a pending Session after changing core intake inputs such as Source Media, Context & Instructions, Template, Extraction Options, or model. It reuses valid prerequisite artifacts when possible, but replaces the prior analysis lineage instead of creating a review revision.
_Avoid_: Revision, undoable branch, automatic rerun on every edit

**Revision**:
A numbered AI-backed iteration created from Final Review corrections, document edits, detected-language corrections that require interpretation, or natural-language revision instructions. Revisions are chronological and linear; the selected Revision is treated as the current output.
_Avoid_: Redo, branch tree, local typo fix

**Detected Language**:
The editable review surface for recognized speakers, people and handles, project terms, and uncertain language. Clear deterministic corrections apply locally, while context-dependent corrections can be routed into a Revision.
_Avoid_: Annotation system, separate glossary editor

**Session Intake**:
The Session workspace where the user chooses a Destination, supplies Context & Instructions, selects a Template, adjusts Extraction Options, starts processing, reviews the formatted Analysis Result, and may change inputs without navigating to another page. A marked OBS recording opens this workspace automatically.
_Avoid_: Automatic processing, OBS-only workflow

**Final Review**:
The document-first review state displayed in the same Session workspace after streaming completes and before filesystem finalization. The user may edit its Markdown directly, correct Detected Language, review Snapshots, request a Revision, or change intake inputs and Redo without navigating backward.
_Avoid_: Separate review page, mandatory section-by-section approval, automatic finalization

**Session Marker**:
A visible, single-use toggle owned by Speech Distiller indicating that the next or currently active OBS recording should open Session Intake after recording stops. OBS and Raycast control it through the local application API, and it automatically disarms after claiming one completed recording.
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
The systematically named directory created inside the selected Destination. Its root contains the verified Session Record, Source Media, and any Snapshot files for exactly one Session. The folder, Session Record, and Source Media share the same approved Recording Date and Short Name basename.
_Avoid_: Job folder, arbitrary meeting folder
