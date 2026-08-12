'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Send, Paperclip } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  buildChatAssetPath,
  CHAT_ASSET_BUCKET,
  CHAT_ASSET_SIGNED_URL_SECONDS,
  CHAT_ATTACHMENT_ACCEPT,
  resolveChatAttachmentMimeType,
  validateChatAttachment,
} from '@/lib/chat-attachments'
import ChatMessage from './chat-message'

interface ChatPanelProps {
  currentUserId: string
  isAdmin: boolean
  className?: string
}

export default function ChatPanel({ currentUserId, isAdmin, className }: ChatPanelProps) {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [users, setUsers] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const selectedUserName = users.find((user) => user.id === selectedUser)?.full_name
    || users.find((user) => user.id === selectedUser)?.email
    || 'member'

  const loadUsers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .neq('id', currentUserId)
      .order('full_name', { ascending: true, nullsFirst: false })

    const availableUsers = data || []
    setUsers(availableUsers)
    setSelectedUser((current) => (
      current && availableUsers.some((user: any) => user.id === current)
        ? current
        : availableUsers[0]?.id || ''
    ))
  }, [currentUserId, supabase])

  // How many unread messages I have from each other member ("who it was from").
  const loadUnread = useCallback(async () => {
    const { data } = await supabase
      .from('chat_messages')
      .select('sender_id')
      .eq('recipient_id', currentUserId)
      .is('read_at', null)
    const counts: Record<string, number> = {}
    for (const row of data || []) counts[row.sender_id] = (counts[row.sender_id] || 0) + 1
    setUnreadBySender(counts)
  }, [currentUserId, supabase])

  const loadMessages = useCallback(async () => {
    if (!selectedUser) {
      setMessages([])
      return
    }

    const { data } = await supabase
      .from('chat_messages')
      .select('*, sender:profiles!chat_messages_sender_id_fkey(full_name, email)')
      .or(
        `and(sender_id.eq.${currentUserId},recipient_id.eq.${selectedUser}),and(sender_id.eq.${selectedUser},recipient_id.eq.${currentUserId})`
      )
      .order('created_at', { ascending: true })

    if (data) {
      // The bucket is private since 092, so an attachment is rendered through a
      // short-lived signed URL rather than the permanent public URL the old client
      // stored on image_url. Signed in one batch here rather than per message, so a
      // conversation costs one request no matter how many files it contains.
      const paths = data.map((m: any) => m.attachment_path).filter(Boolean)
      let signedByPath = new Map<string, string>()
      if (paths.length) {
        const { data: signed } = await supabase.storage
          .from(CHAT_ASSET_BUCKET)
          .createSignedUrls(paths, CHAT_ASSET_SIGNED_URL_SECONDS)
        signedByPath = new Map(
          (signed ?? [])
            .filter((row: any) => row.signedUrl && !row.error)
            .map((row: any) => [row.path, row.signedUrl]),
        )
      }
      setMessages(data.map((m: any) => ({
        ...m,
        // image_url is the legacy fallback for anything sent before 092.
        attachment_url: m.attachment_path ? signedByPath.get(m.attachment_path) ?? null : m.image_url,
      })))
    }

    // Opening a conversation marks its incoming messages as read.
    await supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', currentUserId)
      .eq('sender_id', selectedUser)
      .is('read_at', null)
    loadUnread()
  }, [currentUserId, selectedUser, supabase, loadUnread])

  useEffect(() => {
    loadUsers()
    loadUnread()
  }, [loadUsers, loadUnread])

  useEffect(() => {
    loadMessages()

    if (!selectedUser) return

    const channel = supabase
      .channel(`chat-messages-${currentUserId}-${selectedUser}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
        },
        loadMessages
      )
      .subscribe()

    const interval = setInterval(loadMessages, 5000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [currentUserId, loadMessages, selectedUser, supabase])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !selectedUser) return

    const { error } = await supabase.from('chat_messages').insert({
      sender_id: currentUserId,
      recipient_id: selectedUser,
      message: newMessage.trim(),
    })

    if (!error) {
      setNewMessage('')
      loadMessages()
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedUser) return

    // The bucket enforces both of these too (migration 092) — checking here just
    // turns a failed upload into a readable message.
    const validationError = validateChatAttachment(file)
    if (validationError) {
      setUploadError(validationError)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const mimeType = resolveChatAttachmentMimeType(file)!
    // The path MUST start with the sender's id — the object policies read that back
    // to decide who may upload and delete.
    const filePath = buildChatAssetPath(currentUserId, mimeType)

    setUploading(true)
    setUploadError(null)

    try {
      const { error: uploadError } = await supabase.storage
        .from(CHAT_ASSET_BUCKET)
        .upload(filePath, file, { contentType: mimeType, upsert: false })

      if (uploadError) throw uploadError

      // attachment_path, not a public URL: the bucket is private since 092.
      const { error: messageError } = await supabase.from('chat_messages').insert({
        sender_id: currentUserId,
        recipient_id: selectedUser,
        message: mimeType.startsWith('image/') ? 'Image' : `File: ${file.name}`,
        attachment_path: filePath,
      })

      if (messageError) {
        // Don't leave the object behind eating the shared storage budget with no
        // message pointing at it.
        await supabase.storage.from(CHAT_ASSET_BUCKET).remove([filePath])
        throw messageError
      }

      loadMessages()
    } catch (error: any) {
      console.error('Error uploading file:', error)
      setUploadError(error?.message ? `Could not send file: ${error.message}` : 'Could not send file.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Card className={cn('flex h-[min(72vh,640px)] min-h-[460px] flex-col overflow-hidden', className)}>
      <CardHeader className="border-b p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">
              {selectedUser ? `Chat with ${selectedUserName}` : 'Team chat'}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {isAdmin ? 'Talk to any team member' : 'Talk to admins or teammates'}
            </p>
          </div>
          <Select value={selectedUser} onValueChange={setSelectedUser}>
            <SelectTrigger className="h-10 sm:w-64">
              <SelectValue placeholder="Choose a member" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => {
                const unread = unreadBySender[user.id] || 0
                return (
                  <SelectItem key={user.id} value={user.id}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span>{user.full_name || user.email}</span>
                      {unread > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            isOwn={message.sender_id === currentUserId}
          />
        ))}
        <div ref={messagesEndRef} />

        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            {selectedUser ? 'No messages yet. Start the conversation.' : 'Choose a member to start chatting.'}
          </div>
        )}
      </CardContent>

      <div className="border-t p-4">
        {uploadError && (
          <p className="mb-2 text-xs text-destructive">{uploadError}</p>
        )}
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            // Kept in step with the bucket's MIME allowlist (migration 092) so the
            // picker cannot offer a type the database will refuse.
            accept={CHAT_ATTACHMENT_ACCEPT}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !selectedUser}
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Input
            placeholder={selectedUser ? 'Type a message...' : 'Choose a member first'}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={uploading || !selectedUser}
          />
          <Button
            type="submit"
            size="icon"
            disabled={uploading || !selectedUser || !newMessage.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </Card>
  )
}
