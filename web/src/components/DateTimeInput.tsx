import dayjs from "dayjs";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";

// HTML5 datetime-local input requires this exact format (with the 'T' separator)
const HTML_INPUT_FORMAT = "YYYY-MM-DDTHH:mm";

interface Props {
  value: Date;
  onChange: (date: Date) => void;
}

const DateTimeInput: React.FC<Props> = ({ value, onChange }) => {
  // Convert the Date object to a string the input can understand
  const formattedValue = dayjs(value).format(HTML_INPUT_FORMAT);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    if (inputValue) {
      const newDate = dayjs(inputValue).toDate();

      if (!isNaN(newDate.getTime())) {
        onChange(newDate);
      } else {
        toast.error("Invalid date selected");
      }
    }
  };

  return (
    <input
      type="datetime-local"
      className={cn(
        "px-1 bg-transparent rounded text-xs transition-all",
        "border-transparent outline-none focus:border-border",
        "border",
      )}
      value={formattedValue}
      onChange={handleChange}
    />
  );
};

export default DateTimeInput;
