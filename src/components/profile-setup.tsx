"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2, UserCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

type Me = {
  name?: string | null;
  displayName?: string | null;
  city?: string | null;
  country?: string | null;
  jobTitle?: string | null;
  about?: string | null;
};

/**
 * Compulsory one-time profile window shown to every new user before the app is
 * accessible. Collects the details the assistant needs (name, location, role) so
 * it never has to ask again. Completing it sets `profileCompletedAt`, which
 * un-gates the app.
 */
export function ProfileSetup({ me }: { me: Me }) {
  const save = useMutation(api.users.updateProfile);
  const { toast } = useToast();
  const [displayName, setDisplayName] = React.useState(
    me.displayName ?? me.name ?? "",
  );
  const [city, setCity] = React.useState(me.city ?? "");
  const [country, setCountry] = React.useState(me.country ?? "");
  const [jobTitle, setJobTitle] = React.useState(me.jobTitle ?? "");
  const [about, setAbout] = React.useState(me.about ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || !city.trim()) {
      toast({ title: "Name and city are required", variant: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await save({
        displayName: displayName.trim(),
        city: city.trim(),
        country: country.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
        about: about.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      // The `me` query is reactive — once profileCompletedAt is set, the gate
      // disappears and the app renders.
    } catch (err) {
      toast({
        title: "Could not save your profile",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="pt-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserCircle2 className="size-6" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Welcome — let&apos;s set up your profile</h1>
              <p className="text-sm text-muted-foreground">
                Your assistant uses this so it never has to ask twice. Takes a
                few seconds.
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">
                Your name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="p-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Riyaan Sheth"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-city">
                  City <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="p-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Mumbai"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-country">Country</Label>
                <Input
                  id="p-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. India"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-role">Role / occupation</Label>
              <Input
                id="p-role"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Founder, Product Manager"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-about">
                Anything else the assistant should remember
              </Label>
              <Textarea
                id="p-about"
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder="e.g. Prefer morning meetings; usually book tickets in Mumbai; vegetarian."
                rows={3}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
