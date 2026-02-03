# ColViz – Collaboration Visualization Tool

A visualization tool for analyzing and improving collaboration behaviors in agile teams.

## Context

Agile collaboration can be characterized by four core behaviors: **awareness**, **sharing**, **coordination**, and **improving**. Individual developers exhibit different levels of capability in performing these behaviors. To achieve effective collaboration, managers compose teams by combining developers with complementary capability profiles, tailored to specific team structures and project goals. This applies to both intra-team and inter-team collaboration scenarios.

Collaboration quality is assessed through **congruence**, which represents the degree of alignment between required collaboration behaviors and the behaviors actually enacted by the team.

## Features

ColViz helps managers and team leads understand collaboration dynamics and improve collaboration quality through the following features:

- **Circular Arc Diagram**  
  Visualizes collaboration interactions in a circular layout, with the four behavior types distributed around the perimeter for intuitive comparison.

- **Filters**  
  Enables filtering of interactions by date range, team, data source, and collaboration behavior.

- **Event Drawer**  
  Displays detailed information for each interaction, including access to raw event data.

- **AI Assistant**  
  Provides manager-oriented insights and actionable recommendations for analyzing and improving collaboration behaviors.

## Prerequisites

Prepare a sqlite database placed in `data/colviz.db` and prepare the data according to the schema defined in `prisma/schema.prisma`
    
## Usage

Install dependencies:

```bash
pnpm install

```

Prepare the environment variables with your own `OPENAI_API_KEY`:

```bash
cp .env.example .env
```

Run the server:

```bash
# run the development server
pnpm run dev

# or, build the project and start the server
pnpm build
pnpm start
```
