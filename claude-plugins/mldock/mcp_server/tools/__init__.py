from .login import TOOL_DEF as login_def, handle as login_handle
from .check_login import TOOL_DEF as check_login_def, handle as check_login_handle
from .whoami import TOOL_DEF as whoami_def, handle as whoami_handle
from .generate import TOOL_DEF as generate_def, handle as generate_handle
from .chat import TOOL_DEF as chat_def, handle as chat_handle
from .write_file import TOOL_DEF as write_file_def, handle as write_file_handle
from .upload import TOOL_DEF as upload_def, handle as upload_handle
from .list_trainers import TOOL_DEF as list_trainers_def, handle as list_trainers_handle
from .get_trainer import TOOL_DEF as get_trainer_def, handle as get_trainer_handle
from .trigger_training import TOOL_DEF as trigger_def, handle as trigger_handle
from .job_status import TOOL_DEF as job_status_def, handle as job_status_handle
from .list_datasets import TOOL_DEF as list_datasets_def, handle as list_datasets_handle
from .list_deployments import TOOL_DEF as list_deployments_def, handle as list_deployments_handle

ALL_TOOLS = [
    (login_def, login_handle),
    (check_login_def, check_login_handle),
    (whoami_def, whoami_handle),
    (generate_def, generate_handle),
    (chat_def, chat_handle),
    (write_file_def, write_file_handle),
    (upload_def, upload_handle),
    (list_trainers_def, list_trainers_handle),
    (get_trainer_def, get_trainer_handle),
    (trigger_def, trigger_handle),
    (job_status_def, job_status_handle),
    (list_datasets_def, list_datasets_handle),
    (list_deployments_def, list_deployments_handle),
]
