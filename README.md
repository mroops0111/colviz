# ColViz - Collaboration Visualization Tool

A collaboration behavior visualization tool.

## Features

* **Circular Arc Diagram**: Display collaboration relationships in a circular layout with four behavior types (awareness, coordination, sharing, collaboration) distributed around the perimeter
* **Filters**: Filter data by date range, team, source, and behavior
* **Event Drawer**: Display event details in a drawer, with raw data viewable

## Prerequisites

Prepare a sqlite database placed in `data/colviz.db` and prepare the data according to the schema defined in `prisma/schema.prisma`
    
## Usage

```bash
pnpm install
pnpm run dev 
```
