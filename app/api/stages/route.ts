import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

export const runtime = "nodejs";

/**
 * GET /api/stages?dataset=default
 *
 * Returns stage actors with their day ranges derived from interaction dates.
 * Day numbers are relative to the dataset's earliest interaction date (Day 1).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const datasetName = url.searchParams.get("dataset")?.trim() || "default";

  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return NextResponse.json({ dataset: datasetName, stages: [] });
  }

  // Find the dataset's global min date for day-number calculation
  const globalMin = await prisma.interaction.aggregate({
    where: { datasetId: dataset.id },
    _min: { occurredAt: true },
  });
  const minDate = globalMin._min.occurredAt;
  if (!minDate) {
    return NextResponse.json({ dataset: datasetName, stages: [] });
  }
  const minTime = new Date(
    minDate.getFullYear(),
    minDate.getMonth(),
    minDate.getDate(),
  ).getTime();
  const msPerDay = 1000 * 60 * 60 * 24;

  // Query stage actors and their interaction date ranges
  const stageActors = await prisma.actor.findMany({
    where: { datasetId: dataset.id, actorType: "stage" },
    select: {
      id: true,
      actorKey: true,
      name: true,
      teamInteractions: {
        select: { occurredAt: true },
        orderBy: { occurredAt: "asc" },
        take: 1,
      },
    },
  });

  // For max date, query separately (Prisma doesn't support both asc take-1 and desc take-1 in one relation)
  const stages = await Promise.all(
    stageActors.map(async (actor) => {
      const minInteraction = actor.teamInteractions[0];
      const maxInteraction = await prisma.interaction.findFirst({
        where: { teamId: actor.id, datasetId: dataset.id },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      });

      if (!minInteraction || !maxInteraction) return null;

      const startDay =
        Math.round(
          (new Date(
            minInteraction.occurredAt.getFullYear(),
            minInteraction.occurredAt.getMonth(),
            minInteraction.occurredAt.getDate(),
          ).getTime() -
            minTime) /
            msPerDay,
        ) + 1;
      const endDay =
        Math.round(
          (new Date(
            maxInteraction.occurredAt.getFullYear(),
            maxInteraction.occurredAt.getMonth(),
            maxInteraction.occurredAt.getDate(),
          ).getTime() -
            minTime) /
            msPerDay,
        ) + 1;

      return {
        key: actor.actorKey,
        name: actor.name,
        startDay,
        endDay,
      };
    }),
  );

  const validStages = stages
    .filter(Boolean)
    .sort((a, b) => a!.startDay - b!.startDay);

  return NextResponse.json({ dataset: datasetName, stages: validStages });
}
