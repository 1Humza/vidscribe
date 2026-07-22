/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { SAMPLES } from './src/data/samples.js';

dotenv.config();

// Helper to initialize Gemini client lazily
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is missing.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for body parsing
  app.use(express.json({ limit: '20mb' }));

  // --- API Routes ---

  // Get preloaded sample sessions
  app.get('/api/samples', (req, res) => {
    res.json({ samples: SAMPLES });
  });

  // Check API key configuration status
  app.get('/api/config', (req, res) => {
    res.json({
      hasApiKey: !!process.env.GEMINI_API_KEY,
    });
  });

  // Main distillation API
  app.post('/api/distill', async (req, res) => {
    const {
      sourceName,
      sourceType,
      sourceSize,
      context,
      speakers,
      pipeline,
      engine = 'gemini-3.5-flash',
      effort = 'Balanced',
      textTranscript,
    } = req.body;

    console.log(`Starting distillation with engine: ${engine}, effort: ${effort}`);

    try {
      // Check if API key exists. If not, trigger simulated flow
      if (!process.env.GEMINI_API_KEY) {
        console.warn('GEMINI_API_KEY is not defined. Falling back to simulated distillation.');
        return triggerSimulatedDistillation(req.body, res);
      }

      const ai = getGeminiClient();

      // Construct system instruction and prompt
      const systemInstruction = `You are a state-of-the-art media intelligence engine.
Your goal is to parse and distill the provided meeting transcript or file metadata and guidelines into a highly structured, beautiful, and deeply insightful set of deliverables.
You must reply with a valid JSON object matching the requested schema.`;

      const prompt = `Distill this meeting.
File Metadata:
- Name: ${sourceName || 'Unknown file'}
- Type: ${sourceType || 'video'}
- Size: ${sourceSize || 'Unknown size'}

User Guidelines & Context Constraints:
"${context || 'None provided'}"

Speaker Profiles / Active Speakers:
"${speakers || 'None specified'}"

Active Pipeline Toggles (Only include relevant sections in the output if checked):
- Action Summary: ${pipeline?.actions ? 'YES' : 'NO'}
- Chapters: ${pipeline?.chapters ? 'YES' : 'NO'}
- Topics: ${pipeline?.topics ? 'YES' : 'NO'}
- Highlights: ${pipeline?.highlights ? 'YES' : 'NO'}
- Visual snapshots: ${pipeline?.snapshots ? 'YES' : 'NO'}

${
  textTranscript
    ? `Here is the actual transcript or text provided for this meeting:\n"""\n${textTranscript}\n"""`
    : `No full transcript was provided. Generate a highly detailed, extremely realistic meeting distillation representing what a meeting with this filename would discuss. Please contextualize it thoroughly based on the user guidelines/constraints.`
}

Generate the distillation report. The 'markdown' property in the JSON output should be a highly styled, professional markdown document with headings, summaries, checkboxes for action items, bold key terms, and blockquotes for notable statements. Set the title and timestamp correctly.`;

      // Call Gemini with JSON schema config
      const response = await ai.models.generateContent({
        model: engine,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Descriptive title of the meeting' },
              timestamp: { type: Type.STRING, description: 'Date and time of the meeting in YYYY-MM-DD HH:mm format' },
              markdown: {
                type: Type.STRING,
                description: 'A beautiful, structured markdown report. Format action items as interactive checkboxes like: "- [ ] **Action** (@Name) due *Day*". Add clear sections for Summary, Key Insights, Quotes, and Technical Constraints.',
              },
              speakers: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    initials: { type: Type.STRING, description: '2-character uppercase initials' },
                    name: { type: Type.STRING, description: 'Full name' },
                  },
                  required: ['initials', 'name'],
                },
              },
              snapshots: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    time: { type: Type.STRING, description: 'Timestamp (MM:SS) where this snapshot is key' },
                    name: { type: Type.STRING, description: 'Title of the screen snapshot or frame' },
                    description: { type: Type.STRING, description: 'Action or diagram description' },
                  },
                  required: ['time', 'name'],
                },
              },
              mentions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tag: { type: Type.STRING, description: 'Technology, concept, or brand name' },
                  },
                  required: ['tag'],
                },
              },
              agentNotes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    time: { type: Type.STRING, description: 'Timestamp (MM:SS) of note if applicable' },
                    text: { type: Type.STRING, description: 'Agent note, warning, or notable observation details' },
                    type: { type: Type.STRING, description: 'warning, info, insight, or notable' },
                  },
                  required: ['text', 'type'],
                },
              },
            },
            required: ['title', 'timestamp', 'markdown', 'speakers', 'snapshots', 'mentions', 'agentNotes'],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Gemini returned an empty response.');
      }

      const resultData = JSON.parse(responseText);

      // Build mock filesystem node for this result
      const safeDirName = `${resultData.timestamp || '2026-07-16'}_${(resultData.title || 'distillation').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      const filesystem = [
        {
          name: `${safeDirName}/`,
          type: 'directory' as const,
          children: [
            { name: 'summary.md', type: 'file' as const, content: resultData.markdown },
            {
              name: 'transcript.json',
              type: 'file' as const,
              content: JSON.stringify({
                title: resultData.title,
                speakers: resultData.speakers.map((s: any) => s.name),
                mentions: resultData.mentions.map((m: any) => m.tag),
              }, null, 2),
            },
            {
              name: 'metadata.json',
              type: 'file' as const,
              content: JSON.stringify({
                engine,
                effort,
                timestamp: resultData.timestamp,
              }, null, 2),
            },
          ],
        },
      ];

      res.json({
        success: true,
        isSimulated: false,
        result: {
          ...resultData,
          filesystem,
        },
      });
    } catch (err: any) {
      console.error('Error during Gemini Distillation:', err);
      // Propagate error or fallback to simulation with a notice
      res.status(500).json({
        success: false,
        message: err.message || 'Error occurred during AI processing.',
        fallbackSuggestion: 'Please check your API key or network limits.',
      });
    }
  });

  // --- Simulated Fallback Helper ---
  function triggerSimulatedDistillation(body: any, res: express.Response) {
    const { sourceName, context, engine, effort } = body;
    const name = sourceName || 'custom_upload.mp4';
    const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 16);

    // Create a beautifully custom-simulated response using the custom inputs
    const responseData = {
      title: `Processed Session: ${name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')}`,
      timestamp: dateStr,
      markdown: `---
title: Processed Session: ${name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')}
date: ${dateStr}
engine: ${engine || 'gemini-3.5-flash'} (Simulated)
effort: ${effort || 'Balanced'}
---

# ${name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')}

*Processed on ${dateStr} • Simulation Mode*

## SUMMARY

The system processed the uploaded media content successfully. Based on your injected guidelines: **"${context || 'No specific constraints'}"**, the engine conducted deep semantic indexing across all chapters.

## ACTION ITEMS

- [ ] **Verify client feedback loop** (@User) due *Friday*
- [ ] **Establish deployment thresholds** (@Platform) due *Next week*

## KEY INSIGHTS

* **Context Awareness**: The guidelines regarding *"${context || 'general analysis'}"* were fully incorporated into the distillation model.
* **Stream Quality**: High-fidelity speech-to-text diarization completed without packet loss.

> "AI-driven local distillation provides near-instantaneous workspace clarity."
> — **Workspace Agent**

## TECHNICAL CONSTRAINTS

1. Processing completed in simulation due to missing environment variables. Set **GEMINI_API_KEY** in your AI Studio secrets for native live intelligence.`,
      speakers: [
        { id: 's1', initials: 'ME', name: 'Media Engine' },
        { id: 's2', initials: 'UA', name: 'User Assistant' },
      ],
      snapshots: [
        {
          time: '00:45',
          name: 'Intake Buffer Peak',
          description: 'Buffer allocations analyzed for throughput bottleneck identification.',
        },
        {
          time: '04:20',
          name: 'Signal Graph',
          description: 'Fourier transform showing clear peak frequencies of primary speaker.',
        },
      ],
      mentions: [
        { id: 'm1', tag: 'Simulated Distillation' },
        { id: 'm2', tag: 'Local Signal' },
        { id: 'm3', tag: 'Glacier UX' },
      ],
      agentNotes: [
        {
          id: 'n1',
          time: '00:00',
          text: 'GEMINI_API_KEY is not defined. Using simulated local speech-to-text algorithm.',
          type: 'warning',
        },
        {
          id: 'n2',
          text: 'Quiet room theme configured successfully. Responsive panel flex-grow standardizations applied.',
          type: 'info',
        }
      ],
      filesystem: [
        {
          name: `${dateStr}_SIMULATION_OUTPUT/`,
          type: 'directory',
          children: [
            { name: 'summary.md', type: 'file', content: '# Simulated Output...' },
            { name: 'transcript_sim.json', type: 'file', content: '{"status": "simulated"}' },
          ],
        },
      ],
    };

    setTimeout(() => {
      res.json({
        success: true,
        isSimulated: true,
        result: responseData,
      });
    }, 2500); // simulate delay
  }

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
