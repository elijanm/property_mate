interface Props {
  children: React.ReactNode
}

export default function AuthLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">PMS</h1>
          <p className="text-gray-500 text-sm mt-1">Property Management System</p>
        </div>
        {children}
      </div>
    </div>
  )
}
