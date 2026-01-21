import { createClient } from '@/lib/supabase/server'

export default async function DebugPage() {
  const supabase = await createClient()
  
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  
  let profileData = null
  let profileError = null
  
  if (user) {
    const result = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    
    profileData = result.data
    profileError = result.error
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Debug Information</h1>
        
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-xl font-semibold">Authentication Status</h2>
          <div className="space-y-2">
            <p><strong>User Logged In:</strong> {user ? 'Yes' : 'No'}</p>
            {user && (
              <>
                <p><strong>User ID:</strong> {user.id}</p>
                <p><strong>Email:</strong> {user.email}</p>
              </>
            )}
            {userError && (
              <p className="text-red-600"><strong>Auth Error:</strong> {userError.message}</p>
            )}
          </div>
        </div>

        {user && (
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h2 className="text-xl font-semibold">Profile Information</h2>
            {profileData ? (
              <pre className="bg-slate-100 p-4 rounded overflow-auto">
                {JSON.stringify(profileData, null, 2)}
              </pre>
            ) : (
              <p className="text-red-600">
                <strong>Profile Error:</strong> {profileError?.message || 'No profile found'}
              </p>
            )}
          </div>
        )}

        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-xl font-semibold">Environment Variables</h2>
          <div className="space-y-2">
            <p>
              <strong>NEXT_PUBLIC_SUPABASE_URL:</strong>{' '}
              {process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ Missing'}
            </p>
            <p>
              <strong>NEXT_PUBLIC_SUPABASE_ANON_KEY:</strong>{' '}
              {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-xl font-semibold">Quick Actions</h2>
          <div className="flex gap-4">
            <a
              href="/"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Go to Home
            </a>
            <a
              href="/login"
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Go to Login
            </a>
            <a
              href="/signup"
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Go to Signup
            </a>
            <a
              href="/setup-admin"
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
            >
              Setup Admin
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
