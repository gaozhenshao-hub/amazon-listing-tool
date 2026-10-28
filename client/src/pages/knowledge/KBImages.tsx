import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Image, Package, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLibraryBrowseState } from "./useLibraryBrowseState";
import { KBTagManagement } from "./KBTagManagement";
import SetLibraryBrowse from "./SetLibraryBrowse";
import SingleLibraryBrowse from "./SingleLibraryBrowse";
import VideoLibraryBrowse from "./VideoLibraryBrowse";

export default function KBImages() {
  const [, navigate] = useLocation();
  const [savedView, setView] = useLibraryBrowseState<string>(
    "viewMode",
    "asin"
  );
  const view =
    savedView === "video" ? "video" : savedView === "asin" ? "asin" : "single";
  const [tags, setTags] = useState(false);
  useEffect(() => {
    const oldId = Number(
      new URLSearchParams(window.location.search).get("editSet")
    );
    if (Number.isSafeInteger(oldId) && oldId > 0)
      navigate(`/knowledge/images/${oldId}`, { replace: true });
  }, [navigate]);
  const showTags = () => setTags(true);
  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Image className="h-6 w-6 text-purple-500" />
            智能图片知识库
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            收藏套图、图片和视频，按标签快速查找参考。
          </p>
        </div>
        <nav
          aria-label="知识库视图"
          className="flex rounded-xl border bg-muted/30 p-1"
        >
          {(
            [
              { id: "asin", label: "ASIN集", Icon: Package },
              { id: "single", label: "单图", Icon: Image },
              { id: "video", label: "视频", Icon: Film },
            ] as const
          ).map(({ id, label, Icon }) => (
            <Button
              key={id}
              variant={view === id ? "default" : "ghost"}
              aria-pressed={view === id}
              className="h-10 gap-2 px-5"
              onClick={() => setView(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </nav>
      </header>
      {view === "asin" ? (
        <SetLibraryBrowse onTags={showTags} />
      ) : view === "single" ? (
        <SingleLibraryBrowse onTags={showTags} />
      ) : (
        <VideoLibraryBrowse onTags={showTags} />
      )}
      <Dialog open={tags} onOpenChange={setTags}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>标签管理</DialogTitle>
          </DialogHeader>
          <KBTagManagement
            initialDimension={
              view === "video"
                ? "videoType"
                : view === "single"
                  ? "imageType"
                  : "style"
            }
          />
        </DialogContent>
      </Dialog>
    </main>
  );
}
