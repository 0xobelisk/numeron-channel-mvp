# Numeron Channel MVP

A project built on the Dubhe framework.

## Requirements

- Node.js (v18 or higher recommended)
- pnpm
- Sui development environment

## Getting Started

### 1. Configure Environment Variables

Copy the example environment file to create your local configuration:

```bash
cp apps/web/.env.example apps/web/.env
```

This will set up a pre-configured test account for you.

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Check Development Environment

Run the following command to check your environment and download Sui binaries:

```bash
pnpm dubhe doctor
```

### 4. Install Dubhe Channel Binary

Download the `dubhe-channel` binary and place it in the `~/.dubhe/bin` directory:

**Download URL:**
```
https://github.com/0xobelisk/dubhe/releases/download/v1.2.0-pre.94/dubhe-channel
```

**Installation Steps:**

```bash
# Create directory if it doesn't exist
mkdir -p ~/.dubhe/bin

# Download the binary
curl -L https://github.com/0xobelisk/dubhe/releases/download/v1.2.0-pre.94/dubhe-channel -o ~/.dubhe/bin/dubhe-channel

# Add execute permission
chmod +x ~/.dubhe/bin/dubhe-channel
```

### 5. Start the Project

```bash
pnpm dev
```

## Troubleshooting

If you encounter any issues, please check:

1. Ensure all dependencies are correctly installed
2. Verify that the `dubhe-channel` binary is properly placed in the `~/.dubhe/bin` directory
3. Confirm that `dubhe-channel` has execute permissions
4. Run `pnpm dubhe doctor` to check environment configuration

## More Information

For more details, please visit the [Dubhe Official Documentation](https://github.com/0xobelisk/dubhe).
