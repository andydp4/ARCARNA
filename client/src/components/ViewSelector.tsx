import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { SavedViewRow, ViewState } from "@shared/savedViews/state";
import { Bookmark, Trash2 } from "lucide-react";

type Props = {
  views: SavedViewRow[];
  activeViewId: string | null;
  onSelectView: (view: SavedViewRow | null) => void;
  onSaveCurrent: (name: string, isDefault: boolean) => void;
  onRename: (id: string, name: string) => void;
  onSetDefault: (id: string) => void;
  onDelete: (id: string) => void;
  currentState: ViewState;
  saving?: boolean;
};

export function ViewSelector({
  views,
  activeViewId,
  onSelectView,
  onSaveCurrent,
  onRename,
  onSetDefault,
  onDelete,
  saving,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const handleSave = () => {
    if (!name.trim()) return;
    onSaveCurrent(name.trim(), isDefault);
    setSaveOpen(false);
    setName("");
    setIsDefault(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={activeViewId ?? "all"}
        onValueChange={(v) => {
          if (v === "all") onSelectView(null);
          else {
            const view = views.find((x) => x.id === v);
            if (view) onSelectView(view);
          }
        }}
      >
        <SelectTrigger className="w-[180px] h-9">
          <Bookmark className="h-4 w-4 mr-2 text-muted-foreground" />
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All (no saved view)</SelectItem>
          {views.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name}
              {v.isDefault ? " ★" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
        Save view
      </Button>
      {views.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setManageOpen(true)}>
          Manage
        </Button>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="view-name">Name</Label>
              <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gold customers" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="view-default" checked={isDefault} onCheckedChange={(c) => setIsDefault(c === true)} />
              <Label htmlFor="view-default">Set as my default for this page</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name.trim() || saving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage saved views</DialogTitle>
          </DialogHeader>
          <ul className="space-y-3 py-2">
            {views.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 border rounded-md p-2">
                <div>
                  <div className="font-medium text-sm">{v.name}</div>
                  {v.isDefault && <span className="text-xs text-muted-foreground">Default</span>}
                </div>
                <div className="flex gap-1">
                  {!v.isDefault && (
                    <Button variant="ghost" size="sm" onClick={() => onSetDefault(v.id)}>Set default</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => onRename(v.id, v.name)}>Rename</Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(v.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
