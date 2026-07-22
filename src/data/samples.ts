/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SampleSession } from '../types';

export const SAMPLES: SampleSession[] = [
  {
    id: 'db-migration',
    name: 'Engineering Sync: Database Migration',
    description: 'Relational database schema normalization and OIDC auth migration discussion.',
    source: {
      name: 'meeting_audio_01.mp4',
      sizeStr: '42.5MB',
      durationStr: '24:12',
      dateStr: 'NOV 24',
      type: 'video'
    },
    context: 'Focus on schema bottlenecks, indexing details, and OIDC transition timeline.',
    pipeline: {
      actions: true,
      chapters: true,
      topics: true,
      highlights: true,
      snapshots: true
    },
    engine: 'gemini-3.5-flash',
    effort: 'Balanced',
    result: {
      title: 'Engineering Sync: Database Migration',
      timestamp: '2023-11-24 14:00',
      markdown: `---
title: Engineering Sync: Database Migration
date: 2023-11-24
engine: gemini-3.5-flash
---

# Engineering Sync: Database Migration

*2023-11-24 14:00 GMT | Dur: 24:12 • 4 Speakers*

## SUMMARY

The discussion centered on the critical necessity of normalizing the central relational database schema before proceeding with the Microservices v2 rollout. Consensus was reached regarding the immediate deprecation of the legacy JWT implementation in favor of a unified OIDC flow.

## ACTION ITEMS

- [ ] **Draft Schema v2.0** (@Alex J) due *Friday*
- [ ] **Security Audit: JWT** (@Morgan S) due *Tuesday*

## KEY INSIGHTS

* **Suboptimal Indexing**: Latency issues in East-1 are attributed to suboptimal indexing on transactions.
* **Scaling Bottleneck**: Horizontal scaling is restricted by current stateful sessions.

> "The transition to OIDC isn't just about security; it's the fundamental enabler for our multi-cloud deployment strategy."
> — **Morgan Smith**

## TECHNICAL CONSTRAINTS

Analyzing the transaction throughput bottleneck identified at 14:32...
1. Deprecating Node 12 compatibility
2. Normalizing legacy foreign keys in transaction history tables`,
      speakers: [
        { id: '1', initials: 'AJ', name: 'Alex Johnson' },
        { id: '2', initials: 'MS', name: 'Morgan Smith' },
        { id: '3', initials: 'JL', name: 'Jordan Lee' }
      ],
      snapshots: [
        {
          time: '04:12',
          name: 'Architecture v2',
          description: 'Proposed multi-region replication setup with central OIDC authentication layer.',
          imageUrl: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=400&q=80'
        },
        {
          time: '08:45',
          name: 'Auth Stack',
          description: 'Deprecated stateful JWT token validation flow vs stateless token introspect.',
          imageUrl: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?auto=format&fit=crop&w=400&q=80'
        },
        {
          time: '15:55',
          name: 'Schema Diff',
          description: 'Relational representation of normalized transaction tables after v2 upgrade.',
          imageUrl: 'https://images.unsplash.com/photo-1544383835-bda2bc66a55d?auto=format&fit=crop&w=400&q=80'
        }
      ],
      mentions: [
        { id: 'm1', tag: 'Kubernetes' },
        { id: 'm2', tag: 'JWT Auth' },
        { id: 'm3', tag: 'Schema 2.0' }
      ],
      agentNotes: [
        {
          id: 'n1',
          time: '14:32',
          text: 'Identified speech anomaly where speaker mention of "bottleneck in transaction layer" was slightly garbled but successfully reconstructed.',
          type: 'insight'
        },
        {
          id: 'n2',
          text: 'Security constraints verified against OIDC standards. Recommended token lifespans: Access (15m), Refresh (7d).',
          type: 'notable'
        }
      ],
      filesystem: [
        {
          name: '2023-11-24_ENGINEERING_SYNC_DB_MIGRATION/',
          type: 'directory',
          children: [
            { name: 'summary.md', type: 'file', content: '# Engineering Sync: Database Migration Summary...' },
            { name: 'transcript.json', type: 'file', content: '{\n  "speakers": ["Alex J", "Morgan S", "Jordan L"],\n  "segments": [...]\n}' },
            { name: 'metadata.json', type: 'file', content: '{\n  "engine": "gemini-3.5-flash",\n  "effort": "Balanced"\n}' },
            {
              name: 'ASSETS/',
              type: 'directory',
              children: [
                { name: 'frame_0412.png', type: 'file' },
                { name: 'frame_0845.png', type: 'file' }
              ]
            }
          ]
        }
      ]
    }
  },
  {
    id: 'mobile-redesign',
    name: 'Product Design: Mobile App Redesign',
    description: 'Onboarding flows review, dark theme visual standardizations, and key user retention metrics.',
    source: {
      name: 'product_walkthrough_v3.mp4',
      sizeStr: '112.4MB',
      durationStr: '35:40',
      dateStr: 'DEC 12',
      type: 'video'
    },
    context: 'Focus on onboarding conversion rates, design language upgrades, and navigation menus.',
    pipeline: {
      actions: true,
      chapters: true,
      topics: true,
      highlights: true,
      snapshots: true
    },
    engine: 'gemini-3.1-pro-preview',
    effort: 'High',
    result: {
      title: 'Product Design: Mobile App Redesign',
      timestamp: '2023-12-12 10:00',
      markdown: `---
title: Product Design: Mobile App Redesign
date: 2023-12-12
engine: gemini-3.1-pro-preview
---

# Product Design: Mobile App Redesign

*2023-12-12 10:00 GMT | Dur: 35:40 • 3 Speakers*

## SUMMARY

The design review focused on simplifying the user onboarding experience to reduce drop-offs observed during the phone validation step. The design team presented a new progressive profile building strategy and a refreshed Glacier Glassmorphic theme system for the mobile viewport.

## ACTION ITEMS

- [ ] **Export Figma Asset Package** (@Emma K) due *Monday*
- [ ] **A/B Test Verification Flows** (@Ryan D) due *Next Friday*
- [ ] **Define dark mode palette guidelines** (@Emma K) due *Thursday*

## KEY INSIGHTS

* **Onboarding Friction**: 34% of users exit the registration funnel specifically at the multi-field phone number input.
* **Translucent Layer Preference**: Interactive prototype testing revealed high user delight for soft frosted headers with localized glow indicators.

> "A beautiful layout is useless if users bounce before they get to experience it. Clean up the signup gates first."
> — **David Carter**

## TECHNICAL CONSTRAINTS

1. Target device memory budgets limit backdrop-filter blur radii to a maximum of 12px on legacy devices.
2. SVG optimization required for asset icons to guarantee under 100ms first paint.`,
      speakers: [
        { id: '1', initials: 'EK', name: 'Emma Klaus' },
        { id: '2', initials: 'RD', name: 'Ryan Davis' },
        { id: '3', initials: 'DC', name: 'David Carter' }
      ],
      snapshots: [
        {
          time: '02:15',
          name: 'Old Funnel Dropoff',
          description: 'Funnel visualization chart indicating the spike in dropoffs during Verification.',
          imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=400&q=80'
        },
        {
          time: '12:30',
          name: 'Frosted Glass UI',
          description: 'Interactive glassmorphic prototype showing fluid transitions and custom modals.',
          imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80'
        }
      ],
      mentions: [
        { id: 'm1', tag: 'Figma' },
        { id: 'm2', tag: 'Onboarding' },
        { id: 'm3', tag: 'Glassmorphism' }
      ],
      agentNotes: [
        {
          id: 'n1',
          time: '28:10',
          text: 'Determined potential performance bottlenecks on legacy mobile devices due to backdrop-filter properties.',
          type: 'warning'
        },
        {
          id: 'n2',
          text: 'Figma layout parsed. Auto-generated export configurations verified.',
          type: 'info'
        }
      ],
      filesystem: [
        {
          name: '2023-12-12_MOBILE_APP_REDESIGN/',
          type: 'directory',
          children: [
            { name: 'summary.md', type: 'file', content: '# Product Design Redesign Summary...' },
            { name: 'funnel_analytics.json', type: 'file', content: '{\n  "drop_off": "34%",\n  "verification_exit": "80%"\n}' },
            { name: 'style_guide.md', type: 'file', content: '# Frosted Glass palette...' }
          ]
        }
      ]
    }
  }
];
