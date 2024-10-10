# Define the custom DatabaseError exception
class DatabaseError(Exception):
    def __init__(self, error_message, error_code):
        self.error_message = error_message
        self.error_code = error_code
        super().__init__(f"Database error: {error_message}, Code: {error_code}")
