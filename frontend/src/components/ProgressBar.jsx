export default function ProgressBar({ current, total }) {
  const percentage = Math.min((current / total) * 100, 100);
  
  return (
    <div className="w-full max-w-md mx-auto mb-6">
      <div className="flex justify-between text-xs text-gray-500 mb-2 font-medium">
        <span>Question {current}</span>
        <span>{total} Total</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div 
          className="h-full bg-black transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
    </div>
  );
}
