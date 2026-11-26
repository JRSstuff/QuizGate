import { AppShell } from "@/components/AppShell";
import { LinkQuizExperience } from "@/components/LinkQuizExperience";

export default async function QuizLinkPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <AppShell>
      <LinkQuizExperience runId={runId} />
    </AppShell>
  );
}
