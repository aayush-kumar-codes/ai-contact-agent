import { Plus, MessageSquare, MoreHorizontal, Settings } from 'lucide-react'

export default function Sidebar() {
  return (
    <aside className="w-60 bg-background border-r border-border flex flex-col h-screen">
      {/* Header */}
      <div className="p-5 border-b border-border">
        <button className="w-full flex items-center justify-center gap-2 bg-foreground text-background rounded-md py-2.5 px-4 font-medium hover:bg-foreground/90 transition-colors text-sm">
          <Plus size={18} />
          <span>New Chat</span>
        </button>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="p-3 rounded-md bg-secondary/40 text-foreground hover:bg-secondary/60 cursor-pointer transition-colors">
          <p className="text-sm font-medium truncate">Machine Learning Basics</p>
          <p className="text-xs text-muted-foreground mt-1">Today</p>
        </div>

        <div className="p-3 rounded-md hover:bg-secondary/40 cursor-pointer transition-colors">
          <p className="text-sm font-medium truncate">Web Development Tips</p>
          <p className="text-xs text-muted-foreground mt-1">Yesterday</p>
        </div>

        <div className="p-3 rounded-md hover:bg-secondary/40 cursor-pointer transition-colors">
          <p className="text-sm font-medium truncate">React Optimization</p>
          <p className="text-xs text-muted-foreground mt-1">2 days ago</p>
        </div>

        <div className="p-3 rounded-md hover:bg-secondary/40 cursor-pointer transition-colors">
          <p className="text-sm font-medium truncate">Python Best Practices</p>
          <p className="text-xs text-muted-foreground mt-1">1 week ago</p>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <button className="w-full flex items-center justify-start gap-3 p-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
          <Settings size={16} />
          <span className="text-sm">Settings</span>
        </button>
      </div>
    </aside>
  )
}
