import Button from "@/components/ui/Button";
import Panel from "@/components/dashboard/Panel";

// Campaign nahi mila YA kisi aur advertiser ka hai: dono me yahi same page (kisi ka data/existence leak nahi).
export default function CampaignNotFound() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Campaign not found</h1>
      <div className="mt-6 max-w-xl">
        <Panel title="We could not find this campaign">
          <p className="text-sm text-mist/70">
            It may not exist, or you may not have access to it. Check the link or open the campaign from your list.
          </p>
          <div className="mt-4">
            <Button href="/dashboard/advertiser/campaigns" variant="secondary">
              Back to my campaigns
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
