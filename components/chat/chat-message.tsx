'use client'

import { Card } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import Image from 'next/image'

interface ChatMessageProps {
  message: any
  isOwn: boolean
}

export default function ChatMessage({ message, isOwn }: ChatMessageProps) {
  const isImage = message.image_url && message.message === '📷 Image'
  
  return (
    <div className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : 'flex-row'} animate-in slide-in-from-bottom-2 duration-300`}>
      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
        {message.sender?.full_name?.charAt(0) || message.sender?.email?.charAt(0).toUpperCase() || 'U'}
      </div>
      
      <div className={`flex flex-col gap-1 max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
        <span className="text-xs text-muted-foreground px-2">
          {message.sender?.full_name || message.sender?.email || 'User'}
        </span>
        
        <Card className={`p-3 ${isOwn ? 'bg-blue-600 text-white' : 'bg-white'} shadow-sm`}>
          {isImage ? (
            <a href={message.image_url} target="_blank" rel="noopener noreferrer" className="block">
              <div className="relative w-48 h-48 rounded-lg overflow-hidden">
                <Image 
                  src={message.image_url || "/placeholder.svg"} 
                  alt="Attachment" 
                  fill
                  className="object-cover hover:scale-105 transition-transform"
                />
              </div>
            </a>
          ) : message.image_url ? (
            <a 
              href={message.image_url} 
              target="_blank" 
              rel="noopener noreferrer"
              className={`flex items-center gap-2 ${isOwn ? 'text-white hover:underline' : 'text-blue-600 hover:underline'}`}
            >
              {message.message}
            </a>
          ) : (
            <p className="text-sm whitespace-pre-wrap break-words">{message.message}</p>
          )}
        </Card>
        
        <span className="text-xs text-muted-foreground px-2">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}
