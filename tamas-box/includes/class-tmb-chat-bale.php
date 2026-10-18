<?php
/**
 * Bale (بله) bot bridge for the live chat module.
 *
 * Bale speaks the Telegram Bot API on https://tapi.bale.ai/bot<TOKEN>/<METHOD>
 * (business bots use https://tapi.bale.ai/business/bot<TOKEN>/<METHOD>), so this
 * class is a thin, dependency free client plus the routing logic that turns a
 * Bale update into a reply on the website chat box.
 *
 * Flow
 * ----
 * visitor types on the site  ->  TMB_Chat stores it  ->  TMB_Chat_Bale pushes it
 * to every configured admin chat and remembers the Bale message ids.
 *
 * admin replies inside Bale  ->  webhook (or getUpdates) -> the reply is matched
 * to a session by (a) reply_to_message, (b) an explicit #id prefix or
 * (c) the most recent open session -> stored on the site -> visitor sees it.
 *
 * @package Tamas_Box
 * @since   3.2.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Chat_Bale {

	const TEXT_LIMIT = 4000;

	/**
	 * Chat settings.
	 *
	 * @return array
	 */
	public static function cfg() {
		return TMB_Settings::chat();
	}

	/**
	 * Are we able to talk to Bale at all?
	 *
	 * @return bool
	 */
	public static function is_ready() {
		return self::has_token() && self::admin_chat_ids() !== array();
	}

	/**
	 * Is a bot token configured (and sending enabled)?
	 *
	 * Weaker than is_ready(): enough to answer /id and to fetch updates even
	 * before the admin chat ids are known.
	 *
	 * @return bool
	 */
	public static function has_token() {
		$c = self::cfg();

		return ! empty( $c['bale_enabled'] ) && '' !== trim( (string) $c['bale_token'] );
	}

	/**
	 * Configured admin chats (private chats or groups).
	 *
	 * @return array
	 */
	public static function admin_chat_ids() {
		$c     = self::cfg();
		$parts = preg_split( '/[\s,;،]+/', (string) $c['bale_chat_ids'] );
		$out   = array();

		foreach ( (array) $parts as $part ) {
			$part = trim( (string) $part );
			if ( '' !== $part ) {
				$out[] = $part;
			}
		}

		return array_values( array_unique( $out ) );
	}

	/**
	 * Is this Bale chat allowed to answer customers?
	 *
	 * @param mixed $chat_id Chat id.
	 * @return bool
	 */
	public static function is_admin_chat( $chat_id ) {
		$chat_id = (string) $chat_id;

		foreach ( self::admin_chat_ids() as $allowed ) {
			if ( (string) $allowed === $chat_id ) {
				return true;
			}
			// @username form.
			if ( '@' === substr( $allowed, 0, 1 ) && 0 === strcasecmp( $allowed, $chat_id ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * API base url, e.g. https://tapi.bale.ai/bot
	 *
	 * @return string
	 */
	public static function api_base() {
		$c = self::cfg();
		return self::normalize_base( isset( $c['bale_api_base'] ) ? $c['bale_api_base'] : '' );
	}

	/**
	 * Make sure a base url ends with ".../bot".
	 *
	 * The token is glued straight onto the base, so "https://tapi.bale.ai"
	 * (without /bot) would build a broken url. Never trust what is stored.
	 *
	 * @param string $base Raw base url.
	 * @return string
	 */
	public static function normalize_base( $base ) {
		$base = untrailingslashit( trim( (string) $base ) );

		if ( '' === $base || 0 !== strpos( $base, 'https://' ) ) {
			$base = 'https://tapi.bale.ai/bot';
		}

		if ( ! preg_match( '#/bot$#', $base ) ) {
			$base = rtrim( $base, '/' ) . '/bot';
		}

		return $base;
	}

	/**
	 * The other possible base (normal <-> business), used as a one shot
	 * fallback when Bale answers "Not Found".
	 *
	 * @param string $base Current base.
	 * @return string Empty when there is nothing else to try.
	 */
	protected static function alternate_base( $base ) {
		$base = self::normalize_base( $base );

		if ( false !== strpos( $base, '/business/bot' ) ) {
			return 'https://tapi.bale.ai/bot';
		}

		if ( 'https://tapi.bale.ai/bot' === $base ) {
			return 'https://tapi.bale.ai/business/bot';
		}

		return '';
	}

	/**
	 * Full url of a method.
	 *
	 * Bale expects https://tapi.bale.ai/bot<TOKEN>/<METHOD> - the token is
	 * part of the path, so forgetting it answers with "Not Found".
	 *
	 * @param string $method Method name (with or without a leading slash).
	 * @param string $token  Optional token override (used before the settings are saved).
	 * @return string
	 */
	public static function endpoint( $method, $token = '' ) {
		if ( '' === $token ) {
			$c     = self::cfg();
			$token = (string) $c['bale_token'];
		}

		return self::api_base() . trim( (string) $token ) . '/' . ltrim( (string) $method, '/' );
	}

	/**
	 * Public webhook address (secret is part of the path).
	 *
	 * @return string
	 */
	public static function webhook_url() {
		$c = self::cfg();
		return esc_url_raw( rest_url( 'tmb/v1/chat/bale/' . $c['bale_secret'] ) );
	}

	/* ---------------------------------------------------------------------
	 * Low level API
	 * ------------------------------------------------------------------ */

	/**
	 * Call one Bale method.
	 *
	 * @param string $method Method name.
	 * @param array  $args   Parameters.
	 * @param int    $timeout Request timeout.
	 * @return array|WP_Error Decoded response body.
	 */
	public static function call( $method, $args = array(), $timeout = 20 ) {
		$c = self::cfg();

		if ( '' === trim( (string) $c['bale_token'] ) ) {
			return new WP_Error( 'tmb_no_token', __( 'توکن بازوی بله تنظیم نشده است.', 'tamas-box' ) );
		}

		$result = self::request( self::endpoint( $method ), $args, $timeout, $method );

		/*
		 * "Not Found" almost always means the base url does not fit this bot
		 * (a business bot lives under /business/bot). Try the other base once
		 * and, when it works, remember it so the next call is right away.
		 */
		if ( is_wp_error( $result ) && 404 === (int) $result->get_error_data() ) {
			$alt = self::alternate_base( self::api_base() );

			if ( '' !== $alt ) {
				$alt_result = self::request( self::normalize_base( $alt ) . $c['bale_token'] . '/' . ltrim( $method, '/' ), $args, $timeout, $method );

				if ( ! is_wp_error( $alt_result ) ) {
					self::save_base( $alt );
					self::reset_cfg_cache();
					return $alt_result;
				}
			}
		}

		return $result;
	}

	/**
	 * One HTTP request to the Bale API.
	 *
	 * @param string $url     Full url (base + token + method).
	 * @param array  $args    Parameters.
	 * @param int    $timeout Timeout in seconds.
	 * @param string $method  Method name (for the error log).
	 * @return array|WP_Error Decoded response body.
	 */
	protected static function request( $url, $args, $timeout, $method ) {
		$response = wp_remote_post(
			$url,
			array(
				'timeout'     => $timeout,
				'redirection' => 5,
				'headers'     => array( 'Content-Type' => 'application/json' ),
				'body'        => wp_json_encode( $args ),
			)
		);

		if ( is_wp_error( $response ) ) {
			self::log_error( $method, $response->get_error_message() );
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( ! is_array( $body ) ) {
			$message = sprintf( 'HTTP %d - پاسخ نامعتبر', $code );
			self::log_error( $method, $message );
			return new WP_Error( 'tmb_bad_response', sprintf( __( 'پاسخ نامعتبر از بله (کد %d).', 'tamas-box' ), $code ), $code );
		}

		if ( empty( $body['ok'] ) ) {
			$description = isset( $body['description'] ) ? $body['description'] : __( 'خطای نامشخص', 'tamas-box' );
			$error_code    = isset( $body['error_code'] ) ? (int) $body['error_code'] : $code;
			self::log_error( $method, $description );
			return new WP_Error( 'tmb_bale_error', $description, $error_code );
		}

		self::log_error( $method, '' );

		return $body;
	}

	/**
	 * Persist a working API base into the settings (raw option, no re-sanitize).
	 *
	 * @param string $base Base url.
	 * @return void
	 */
	protected static function save_base( $base ) {
		$raw = get_option( TMB_OPTION, array() );

		if ( ! is_array( $raw ) ) {
			return;
		}
		if ( ! isset( $raw['chat'] ) || ! is_array( $raw['chat'] ) ) {
			$raw['chat'] = array();
		}

		$raw['chat']['bale_api_base'] = self::normalize_base( $base );

		update_option( TMB_OPTION, $raw );
	}

	/**
	 * Keep the newest error so the settings screen can show it.
	 *
	 * @param string $method  Method.
	 * @param string $message Error text (empty clears it).
	 * @return void
	 */
	protected static function log_error( $method, $message ) {
		if ( '' === $message ) {
			TMB_Chat_DB::set_state( 'bale_last_error', '' );
			return;
		}

		TMB_Chat_DB::set_state(
			'bale_last_error',
			array(
				'method'  => $method,
				'message' => substr( (string) $message, 0, 300 ),
				'time'    => time(),
			)
		);
	}

	/**
	 * Latest API error (for the admin screen).
	 *
	 * @return array
	 */
	public static function last_error() {
		$error = TMB_Chat_DB::get_state( 'bale_last_error', array() );
		return is_array( $error ) ? $error : array();
	}

	/**
	 * getMe - used to validate the token.
	 *
	 * @return array|WP_Error
	 */
	public static function get_me() {
		$result = self::call( '/getMe' );

		if ( ! is_wp_error( $result ) && ! empty( $result['result'] ) ) {
			$bot   = $result['result'];
			$c     = self::cfg();
			$state = TMB_Chat_DB::state();

			$state['bot_id']       = isset( $bot['id'] ) ? (string) $bot['id'] : '';
			$state['bot_username'] = isset( $bot['username'] ) ? $bot['username'] : '';
			$state['bot_name']     = isset( $bot['first_name'] ) ? $bot['first_name'] : '';
			TMB_Chat_DB::save_state( $state );

			// Keep the bot identity visible in the settings screen.
			self::remember_bot( $bot );
		}

		return $result;
	}

	/**
	 * Store bot identity inside the plugin settings (shown in the admin UI).
	 *
	 * @param array $bot Bot user object.
	 * @return void
	 */
	protected static function remember_bot( $bot ) {
		$raw = get_option( TMB_OPTION, array() );

		if ( ! is_array( $raw ) ) {
			$raw = array();
		}
		if ( empty( $raw['chat'] ) || ! is_array( $raw['chat'] ) ) {
			$raw['chat'] = TMB_Settings::chat_defaults();
		}

		$changed = false;

		if ( ! empty( $bot['username'] ) && $raw['chat']['bale_bot_username'] !== $bot['username'] ) {
			$raw['chat']['bale_bot_username'] = sanitize_text_field( $bot['username'] );
			$changed = true;
		}
		if ( ! empty( $bot['first_name'] ) && $raw['chat']['bale_bot_name'] !== $bot['first_name'] ) {
			$raw['chat']['bale_bot_name'] = sanitize_text_field( $bot['first_name'] );
			$changed = true;
		}

		if ( $changed ) {
			update_option( TMB_OPTION, $raw );
		}
	}

	/**
	 * Send a text message, with an automatic plain-text retry.
	 *
	 * @param mixed $chat_id Target chat.
	 * @param string $text   Text (already escaped for HTML when $html is true).
	 * @param array  $extra  Extra API parameters.
	 * @param bool   $html   Use parse_mode=HTML on the first attempt.
	 * @return array|WP_Error
	 */
	public static function send_text( $chat_id, $text, $extra = array(), $html = true ) {
		$text = (string) $text;

		if ( '' === trim( $text ) ) {
			return new WP_Error( 'tmb_empty_text', __( 'متن پیام خالی است.', 'tamas-box' ) );
		}

		$chunks = self::split_text( $text );
		$last   = null;

		foreach ( $chunks as $chunk ) {
			$args = array_merge(
				array(
					'chat_id' => $chat_id,
					'text'    => $chunk,
				),
				$extra
			);

			if ( $html && ! isset( $args['parse_mode'] ) ) {
				$args['parse_mode'] = 'HTML';
			}

			$result = self::call( '/sendMessage', $args );

			// Some Bale bot flavours reject markup entities - retry unformatted.
			if ( is_wp_error( $result ) && $html && isset( $args['parse_mode'] ) && self::is_format_error( $result ) ) {
				unset( $args['parse_mode'] );
				$result = self::call( '/sendMessage', $args );
			}

			$last = $result;
		}

		return $last;
	}

	/**
	 * Was this failure caused by text formatting?
	 *
	 * @param WP_Error $error Error.
	 * @return bool
	 */
	protected static function is_format_error( $error ) {
		$message = strtolower( (string) $error->get_error_message() );

		return false !== strpos( $message, 'parse' ) || false !== strpos( $message, 'entit' );
	}

	/**
	 * Split long texts into API friendly chunks (line aware).
	 *
	 * @param string $text Text.
	 * @return array
	 */
	protected static function split_text( $text ) {
		if ( function_exists( 'mb_strlen' ) ) {
			$length = mb_strlen( $text, 'UTF-8' );
		} else {
			$length = strlen( $text );
		}

		if ( $length <= self::TEXT_LIMIT ) {
			return array( $text );
		}

		$lines  = explode( "\n", $text );
		$chunks = array();
		$current = '';

		foreach ( $lines as $line ) {
			$line_length = function_exists( 'mb_strlen' ) ? mb_strlen( $line, 'UTF-8' ) : strlen( $line );

			if ( $line_length > self::TEXT_LIMIT ) {
				if ( '' !== $current ) {
					$chunks[] = $current;
					$current  = '';
				}
				$pieces = function_exists( 'mb_str_split' )
					? mb_str_split( $line, self::TEXT_LIMIT )
					: str_split( $line, self::TEXT_LIMIT );
				foreach ( $pieces as $piece ) {
					$chunks[] = $piece;
				}
				continue;
			}

			$candidate = ( '' === $current ) ? $line : $current . "\n" . $line;
			$candidate_length = function_exists( 'mb_strlen' ) ? mb_strlen( $candidate, 'UTF-8' ) : strlen( $candidate );

			if ( $candidate_length > self::TEXT_LIMIT ) {
				$chunks[] = $current;
				$current  = $line;
			} else {
				$current = $candidate;
			}
		}

		if ( '' !== $current ) {
			$chunks[] = $current;
		}

		return $chunks;
	}

	/**
	 * setWebhook.
	 *
	 * @param string $url Webhook url.
	 * @return array|WP_Error
	 */
	public static function set_webhook( $url = '' ) {
		$url = $url ? $url : self::webhook_url();
		return self::call( '/setWebhook', array( 'url' => $url ) );
	}

	/**
	 * deleteWebhook (needed before switching to getUpdates).
	 *
	 * @return array|WP_Error
	 */
	public static function delete_webhook() {
		return self::call( '/deleteWebhook', array() );
	}

	/**
	 * getWebhookInfo.
	 *
	 * @return array|WP_Error
	 */
	public static function webhook_info() {
		return self::call( '/getWebhookInfo' );
	}

	/**
	 * getUpdates (long polling).
	 *
	 * @param int $offset  Offset.
	 * @param int $limit   Limit.
	 * @param int $timeout Long poll timeout in seconds.
	 * @return array|WP_Error
	 */
	public static function get_updates( $offset = 0, $limit = 50, $timeout = 20 ) {
		return self::call(
			'/getUpdates',
			array(
				'offset'  => (int) $offset,
				'limit'   => (int) $limit,
				'timeout' => (int) $timeout,
			),
			$timeout + 15
		);
	}

	/**
	 * getFile - resolve a file_id into a downloadable path.
	 *
	 * @param string $file_id File id.
	 * @return string|WP_Error Absolute https url of the file.
	 */
	public static function file_url( $file_id ) {
		$result = self::call( '/getFile', array( 'file_id' => $file_id ), 25 );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$path = isset( $result['result']['file_path'] ) ? $result['result']['file_path'] : '';
		if ( '' === $path ) {
			return new WP_Error( 'tmb_no_file_path', __( 'مسیر فایل از بله دریافت نشد.', 'tamas-box' ) );
		}

		$c = self::cfg();

		return 'https://tapi.bale.ai/file/bot' . $c['bale_token'] . '/' . ltrim( $path, '/' );
	}

	/**
	 * answerCallbackQuery (best effort).
	 *
	 * @param string $callback_id Callback id.
	 * @param string $text        Toast text.
	 * @return void
	 */
	public static function answer_callback( $callback_id, $text = '' ) {
		if ( '' === (string) $callback_id ) {
			return;
		}

		self::call(
			'/answerCallbackQuery',
			array(
				'callback_query_id' => $callback_id,
				'text'              => (string) $text,
			),
			10
		);
	}

	/* ---------------------------------------------------------------------
	 * Outbound: site -> Bale
	 * ------------------------------------------------------------------ */

	/**
	 * Human readable title of a session.
	 *
	 * @param array $session Session row.
	 * @return string
	 */
	public static function session_label( $session ) {
		$name = ! empty( $session['name'] ) ? $session['name'] : '';

		if ( '' === $name ) {
			$name = ( ! empty( $session['user_id'] ) && (int) $session['user_id'] > 0 )
				? __( 'کاربر سایت', 'tamas-box' )
				: __( 'مهمان', 'tamas-box' );
		}

		return $name;
	}

	/**
	 * Announcement sent when a brand new conversation starts.
	 *
	 * @param array $session Session row.
	 * @param array $message Message row.
	 * @return void
	 */
	public static function notify_new_session( $session, $message = array() ) {
		if ( ! self::is_ready() || empty( self::cfg()['bale_notify_new'] ) ) {
			return;
		}

		$id   = (int) $session['id'];
		$line = '<b>' . esc_html__( 'گفتگوی جدید', 'tamas-box' ) . ' #' . $id . '</b>' . "\n";
		$line .= '👤 ' . esc_html( self::session_label( $session ) );

		if ( ! empty( $session['contact'] ) ) {
			$line .= ' — ' . esc_html( $session['contact'] );
		}

		$line .= "\n🕒 " . esc_html( self::format_time( time() ) );

		if ( ! empty( self::cfg()['bale_include_page'] ) && ! empty( $session['page_url'] ) ) {
			$line .= "\n🔗 <a href=\"" . esc_url( $session['page_url'] ) . '">' . esc_html( self::short_url( $session['page_url'] ) ) . '</a>';
		}

		if ( ! empty( self::cfg()['bale_include_ip'] ) && ! empty( $session['ip'] ) ) {
			$line .= "\n🌐 " . esc_html( $session['ip'] );
		}

		if ( ! empty( $message['body'] ) ) {
			$line .= "\n────────\n" . esc_html( $message['body'] );
		}

		$line .= "\n────────\n" . esc_html__( 'برای پاسخ: روی همین پیام Reply بزنید، یا بنویسید:', 'tamas-box' )
			. "\n/reply " . $id . ' ' . esc_html__( 'متن پاسخ شما', 'tamas-box' );

		self::broadcast( $session, $line, self::keyboard( $session ) );
	}

	/**
	 * Push one visitor message to every admin chat.
	 *
	 * @param array $session Session row.
	 * @param array $message Message row (id, body, attachment).
	 * @return void
	 */
	public static function notify_visitor_message( $session, $message ) {
		if ( ! self::is_ready() ) {
			return;
		}

		$id   = (int) $session['id'];
		$line = '💬 <b>#' . $id . '</b> | ' . esc_html( self::session_label( $session ) ) . "\n";

		if ( ! empty( $message['body'] ) ) {
			$line .= esc_html( $message['body'] );
		}

		$attachment = self::attachment_of( $message );
		if ( $attachment ) {
			$line .= ( ! empty( $message['body'] ) ? "\n" : '' ) . '📎 ' . esc_html( self::attachment_label( $attachment ) );
		}

		$line .= "\n" . esc_html( self::format_time( isset( $message['created_at'] ) ? (int) $message['created_at'] : time() ) );

		self::broadcast( $session, $line );
	}

	/**
	 * Tell the admins that the conversation was closed / reopened / answered
	 * from the WordPress inbox, so Bale always shows the full picture.
	 *
	 * @param array  $session Session row.
	 * @param string $text    Already escaped HTML text.
	 * @return void
	 */
	public static function notify_status( $session, $text ) {
		if ( ! self::is_ready() ) {
			return;
		}

		self::broadcast( $session, $text );
	}

	/**
	 * Mirror a reply that was written in the WordPress inbox into Bale.
	 *
	 * @param array $session Session row.
	 * @param array $message Message row.
	 * @return void
	 */
	public static function sync_agent_reply( $session, $message ) {
		$c = self::cfg();

		if ( ! self::is_ready() || empty( $c['bale_sync_admin'] ) ) {
			return;
		}

		$line = '↩️ <b>#' . (int) $session['id'] . '</b> | ' . esc_html__( 'پاسخ از پیشخوان سایت', 'tamas-box' );

		if ( ! empty( $message['agent_name'] ) ) {
			$line .= ' (' . esc_html( $message['agent_name'] ) . ')';
		}

		$line .= "\n" . esc_html( isset( $message['body'] ) ? $message['body'] : '' );

		self::broadcast( $session, $line );
	}

	/**
	 * Send a text to all admin chats and map the resulting message ids.
	 *
	 * @param array      $session  Session row.
	 * @param string     $text     Escaped HTML text.
	 * @param array|null $keyboard Optional inline keyboard.
	 * @return void
	 */
	protected static function broadcast( $session, $text, $keyboard = null ) {
		$extra = array();

		if ( is_array( $keyboard ) ) {
			$extra['reply_markup'] = $keyboard;
		}

		$session_id = isset( $session['id'] ) ? (int) $session['id'] : 0;

		foreach ( self::admin_chat_ids() as $chat_id ) {
			$result = self::send_text( $chat_id, $text, $extra );

			if ( is_wp_error( $result ) ) {
				continue;
			}

			$bale_message_id = isset( $result['result']['message_id'] ) ? (int) $result['result']['message_id'] : 0;
			$bale_chat_id    = isset( $result['result']['chat']['id'] ) ? (int) $result['result']['chat']['id'] : (int) $chat_id;

			if ( $bale_message_id && $session_id ) {
				TMB_Chat_DB::map_bale_message( $bale_chat_id, $bale_message_id, $session_id );
			}
		}
	}

	/**
	 * Inline keyboard attached to the "new conversation" notification.
	 *
	 * @param array $session Session.
	 * @return array
	 */
	protected static function keyboard( $session ) {
		$id      = (int) $session['id'];
		$inbox   = admin_url( 'admin.php?page=tamas-box-chats&chat=' . $id );
		$rows    = array();
		$rows[]  = array(
			array(
				'text' => '🖥 ' . __( 'باز کردن در پیشخوان', 'tamas-box' ),
				'url'  => $inbox,
			),
		);
		$rows[] = array(
			array(
				'text'         => '✅ ' . __( 'بستن گفتگو', 'tamas-box' ),
				'callback_data' => 'tmbclose:' . $id,
			),
			array(
				'text'         => '👤 ' . __( 'جزئیات', 'tamas-box' ),
				'callback_data' => 'tmbinfo:' . $id,
			),
		);

		return array( 'inline_keyboard' => $rows );
	}

	/**
	 * Decode the attachment of a message row.
	 *
	 * @param array $message Message row.
	 * @return array
	 */
	protected static function attachment_of( $message ) {
		if ( empty( $message['attachment'] ) ) {
			return array();
		}

		if ( is_array( $message['attachment'] ) ) {
			return $message['attachment'];
		}

		$data = json_decode( (string) $message['attachment'], true );

		return is_array( $data ) ? $data : array();
	}

	/**
	 * One line description of an attachment.
	 *
	 * @param array $attachment Attachment.
	 * @return string
	 */
	public static function attachment_label( $attachment ) {
		$type = isset( $attachment['type'] ) ? $attachment['type'] : 'file';
		$name = isset( $attachment['name'] ) ? $attachment['name'] : '';

		$labels = array(
			'photo'    => __( 'تصویر', 'tamas-box' ),
			'voice'    => __( 'پیام صوتی', 'tamas-box' ),
			'audio'    => __( 'فایل صوتی', 'tamas-box' ),
			'video'    => __( 'ویدیو', 'tamas-box' ),
			'document' => __( 'فایل', 'tamas-box' ),
			'sticker'  => __( 'استیکر', 'tamas-box' ),
			'gif'      => __( 'تصویر متحرک', 'tamas-box' ),
		);

		$label = isset( $labels[ $type ] ) ? $labels[ $type ] : $type;

		return $name ? $label . ' — ' . $name : $label;
	}

	/**
	 * Short version of a url for chat previews.
	 *
	 * @param string $url Url.
	 * @return string
	 */
	protected static function short_url( $url ) {
		$parts = wp_parse_url( $url );
		$host  = isset( $parts['host'] ) ? $parts['host'] : '';
		$path  = isset( $parts['path'] ) ? $parts['path'] : '';

		if ( function_exists( 'mb_strlen' ) && mb_strlen( $path, 'UTF-8' ) > 40 ) {
			$path = mb_substr( $path, 0, 40, 'UTF-8' ) . '…';
		}

		return $host . $path;
	}

	/**
	 * Site time formatted for humans.
	 *
	 * @param int $ts Timestamp.
	 * @return string
	 */
	public static function format_time( $ts ) {
		$ts = (int) $ts;
		return wp_date( 'Y/m/d H:i', $ts );
	}

	/* ---------------------------------------------------------------------
	 * Inbound: Bale -> site
	 * ------------------------------------------------------------------ */

	/**
	 * Process one Telegram-style Update object.
	 *
	 * @param array $update Update.
	 * @return void
	 */
	public static function handle_update( $update ) {
		if ( empty( $update ) || ! is_array( $update ) ) {
			return;
		}

		/* de-duplicate (webhook + polling can overlap) */
		$update_id = isset( $update['update_id'] ) ? (int) $update['update_id'] : 0;
		if ( $update_id ) {
			$seen = (int) TMB_Chat_DB::get_state( 'last_update_id', 0 );
			if ( $update_id <= $seen ) {
				return;
			}
			TMB_Chat_DB::set_state( 'last_update_id', $update_id );
		}

		if ( ! empty( $update['callback_query'] ) ) {
			self::handle_callback( $update['callback_query'] );
			return;
		}

		$message = null;
		if ( ! empty( $update['message'] ) ) {
			$message = $update['message'];
		} elseif ( ! empty( $update['edited_message'] ) ) {
			$message = $update['edited_message'];
		}

		if ( ! is_array( $message ) ) {
			return;
		}

		$chat_id = isset( $message['chat']['id'] ) ? (int) $message['chat']['id'] : 0;
		if ( ! $chat_id ) {
			return;
		}

		$c = self::cfg();

		$text       = isset( $message['text'] ) ? trim( (string) $message['text'] ) : '';
		$is_admin   = self::is_admin_chat( $chat_id );
		$agent_name = self::agent_name( $message );

		/*
		 * /start, /id and /help are answered to EVERYBODY. Without this the
		 * owner could never find out their own chat_id, because the "only
		 * known chats may talk" rule would reject them first.
		 */
		if ( '' !== $text && '/' === substr( $text, 0, 1 ) ) {
			$cmd = self::command_name( $text );

			if ( in_array( $cmd, array( 'start', 'id', 'help' ), true ) ) {
				self::handle_start_command( $chat_id, $text, $cmd, $is_admin );
				return;
			}

			if ( ! $is_admin && ! empty( $c['only_admins_reply'] ) ) {
				self::reject_stranger( $chat_id );
				return;
			}

			if ( empty( $c['bale_commands'] ) ) {
				return;
			}

			self::handle_command( $chat_id, $text, $agent_name, $message );
			return;
		}

		/* nobody except the configured admins may drive the bot */
		if ( ! empty( $c['only_admins_reply'] ) && ! $is_admin ) {
			self::reject_stranger( $chat_id );
			return;
		}

		$has_media  = self::has_media( $message );
		$attachment = array();

		if ( '' === $text ) {
			if ( ! empty( $message['caption'] ) ) {
				$text = trim( (string) $message['caption'] );
			} elseif ( ! $has_media ) {
				return;
			}
		}

		$session = self::resolve_session( $chat_id, $message, $text );

		if ( $session && $has_media ) {
			$attachment = self::extract_attachment( $message, (int) $session['id'] );
		}

		// "#12 سلام" should be stored as "سلام".
		if ( $session && '' !== $text ) {
			$text = self::strip_session_code( $text, (int) $session['id'] );
		}

		if ( '' === $text && empty( $attachment ) ) {
			return;
		}

		if ( ! $session ) {
			self::send_text(
				$chat_id,
				'⚠️ ' . esc_html__( 'گفتگوی مورد نظر پیدا نشد. روی پیام کاربر Reply بزنید یا کد گفتگو را اول پیام بنویسید، مثال:', 'tamas-box' )
					. "\n<code>/reply 12 " . esc_html__( 'متن پاسخ', 'tamas-box' ) . '</code>'
					. "\n" . esc_html__( 'فهرست گفتگوهای باز:', 'tamas-box' ) . " <code>/chats</code>"
			);
			return;
		}

		TMB_Chat::store_agent_message(
			(int) $session['id'],
			$text,
			$attachment,
			$agent_name,
			'bale',
			array(
				'chat_id'    => $chat_id,
				'message_id' => isset( $message['message_id'] ) ? (int) $message['message_id'] : 0,
			)
		);
	}

	/**
	 * Lowercase command name of a message ("/Reply@mybot 12 hi" -> "reply").
	 *
	 * @param string $text Message text.
	 * @return string
	 */
	protected static function command_name( $text ) {
		$text = ltrim( (string) $text, '/' );
		$head = preg_split( '/[\s@]+/', $text, 2 );
		$cmd  = isset( $head[0] ) ? strtolower( trim( (string) $head[0] ) ) : '';

		return preg_replace( '/[^a-z0-9_]/', '', $cmd );
	}

	/**
	 * Answer /start, /id and /help - also the "register me as an admin" link.
	 *
	 * @param int    $chat_id  Chat.
	 * @param string $text     Full text (may carry the join parameter).
	 * @param string $cmd      start|id|help.
	 * @param bool   $is_admin Already a known admin chat?
	 * @return void
	 */
	protected static function handle_start_command( $chat_id, $text, $cmd, $is_admin ) {
		/* /start tmbadmin_<code> -> become an admin without touching settings */
		if ( preg_match( '/tmbadmin_([A-Za-z0-9]{6,64})/', (string) $text, $matches ) ) {
			if ( self::join_code_ok( $matches[1] ) ) {
				self::register_admin_chat( $chat_id );
				self::send_text(
					$chat_id,
					'✅ <b>' . esc_html__( 'شما به‌عنوان مدیر گفتگو ثبت شدید.', 'tamas-box' ) . '</b>'
						. "\n" . esc_html__( 'شناسه چت شما:', 'tamas-box' ) . ' <code>' . esc_html( (string) $chat_id ) . '</code>'
						. "\n" . esc_html__( 'از این پس پیام مشتریان اینجا می‌آید و می‌توانید پاسخ دهید.', 'tamas-box' ),
					array(),
					true
				);
				return;
			}

			self::send_text(
				$chat_id,
				'⚠️ ' . esc_html__( 'لینک ثبت مدیر منقضی شده است. در تنظیمات افزونه دوباره «لینک ثبت مدیر» را بسازید.', 'tamas-box' )
					. "\n" . esc_html__( 'شناسه چت شما:', 'tamas-box' ) . ' <code>' . esc_html( (string) $chat_id ) . '</code>'
			);
			return;
		}

		if ( 'id' === $cmd || ( 'start' === $cmd && ! $is_admin ) ) {
			$title = '';
			$line  = '🔑 <b>chat_id</b>: <code>' . esc_html( (string) $chat_id ) . '</code>';

			if ( $is_admin ) {
				$line .= "\n✅ " . esc_html__( 'این چت به‌عنوان مدیر ثبت شده است.', 'tamas-box' );
			} else {
				$line .= "\n" . esc_html__( 'این عدد را در «تماس باکس ← چت آنلاین ← شناسه چت مدیران» وارد کنید و تنظیمات را ذخیره کنید.', 'tamas-box' );

				if ( self::admin_chat_ids() === array() ) {
					$line .= "\n⚠️ " . esc_html__( 'فعلاً هیچ مدیری ثبت نشده، بنابراین پیام مشتریان به جایی فرستاده نمی‌شود.', 'tamas-box' );
				}
			}

			self::send_text( $chat_id, $line . $title );
			return;
		}

		self::send_text( $chat_id, self::help_text() );

		if ( ! $is_admin ) {
			self::send_text(
				$chat_id,
				'🔑 <b>chat_id</b>: <code>' . esc_html( (string) $chat_id ) . '</code>'
			);
		}
	}

	/**
	 * Create (or reuse) a short lived code that turns a Bale chat into an admin.
	 *
	 * @return string Join code.
	 */
	public static function make_join_code() {
		$code = substr( md5( wp_generate_password( 24, false, false ) . microtime() ), 0, 20 );

		TMB_Chat_DB::set_state( 'admin_join_code', $code );
		TMB_Chat_DB::set_state( 'admin_join_exp', time() + DAY_IN_SECONDS );

		return $code;
	}

	/**
	 * Is this join code still valid?
	 *
	 * @param string $code Code from the deep link.
	 * @return bool
	 */
	protected static function join_code_ok( $code ) {
		$stored = (string) TMB_Chat_DB::get_state( 'admin_join_code', '' );
		$exp    = (int) TMB_Chat_DB::get_state( 'admin_join_exp', 0 );

		if ( '' === $stored || $exp < time() ) {
			return false;
		}

		if ( ! hash_equals( $stored, (string) $code ) ) {
			return false;
		}

		TMB_Chat_DB::set_state( 'admin_join_code', '' );
		TMB_Chat_DB::set_state( 'admin_join_exp', 0 );

		return true;
	}

	/**
	 * Deep link that registers the person who opens it as an admin.
	 *
	 * @return string|WP_Error
	 */
	public static function admin_join_url() {
		$c        = self::cfg();
		$username = trim( (string) $c['bale_bot_username'] );

		if ( '' === $username ) {
			$username = (string) TMB_Chat_DB::get_state( 'bot_username', '' );
		}

		if ( '' === $username ) {
			$me = self::get_me();

			if ( is_wp_error( $me ) ) {
				return $me;
			}

			$username = isset( $me['result']['username'] ) ? (string) $me['result']['username'] : '';
		}

		if ( '' === $username ) {
			return new WP_Error(
				'tmb_no_username',
				__( 'نام کاربری بازو پیدا نشد. ابتدا «تست اتصال» را بزنید یا نام کاربری بازو را در تنظیمات وارد کنید.', 'tamas-box' )
			);
		}

		return 'https://ble.ir/' . rawurlencode( ltrim( $username, '@' ) ) . '?start=tmbadmin_' . self::make_join_code();
	}

	/**
	 * Add a Bale chat to the admin list (used by the join link).
	 *
	 * @param int|string $chat_id Chat.
	 * @return bool
	 */
	public static function register_admin_chat( $chat_id ) {
		$chat_id = trim( (string) $chat_id );

		if ( '' === $chat_id ) {
			return false;
		}

		$raw = get_option( TMB_OPTION, array() );

		if ( ! is_array( $raw ) ) {
			$raw = array();
		}
		if ( ! isset( $raw['chat'] ) || ! is_array( $raw['chat'] ) ) {
			$raw['chat'] = array();
		}

		$current = isset( $raw['chat']['bale_chat_ids'] ) ? (string) $raw['chat']['bale_chat_ids'] : '';
		$ids     = array();

		foreach ( preg_split( '/[\s,;،]+/', $current ) as $part ) {
			$part = trim( (string) $part );
			if ( '' !== $part ) {
				$ids[] = $part;
			}
		}

		if ( in_array( $chat_id, $ids, true ) ) {
			return true;
		}

		$ids[]                        = $chat_id;
		$raw['chat']['bale_chat_ids'] = implode( "\n", array_slice( $ids, 0, 20 ) );

		update_option( TMB_OPTION, $raw );

		// Drop the cached copy so the new id is used right away.
		TMB_Chat::reset_cfg_cache();

		return true;
	}

	/**
	 * Inline button clicks.
	 *
	 * @param array $callback Callback query.
	 * @return void
	 */
	protected static function handle_callback( $callback ) {
		$data = isset( $callback['data'] ) ? (string) $callback['data'] : '';
		$id   = isset( $callback['id'] ) ? (string) $callback['id'] : '';

		$message = isset( $callback['message'] ) ? $callback['message'] : array();
		$chat_id = isset( $message['chat']['id'] ) ? (int) $message['chat']['id'] : 0;

		$c = self::cfg();
		if ( ! empty( $c['only_admins_reply'] ) && ! self::is_admin_chat( $chat_id ) ) {
			self::answer_callback( $id, '' );
			return;
		}

		$session_id = 0;
		$action     = '';

		if ( 0 === strpos( $data, 'tmbclose:' ) ) {
			$action     = 'close';
			$session_id = (int) substr( $data, 9 );
		} elseif ( 0 === strpos( $data, 'tmbinfo:' ) ) {
			$action     = 'info';
			$session_id = (int) substr( $data, 8 );
		}

		if ( ! $session_id ) {
			return;
		}

		$session = TMB_Chat_DB::get_session( $session_id );
		if ( ! $session ) {
			self::answer_callback( $id, __( 'گفتگو پیدا نشد.', 'tamas-box' ) );
			return;
		}

		if ( 'close' === $action ) {
			TMB_Chat::set_session_status( $session_id, 'closed', __( 'پشتیبانی (بله)', 'tamas-box' ) );
			self::answer_callback( $id, __( 'گفتگو بسته شد.', 'tamas-box' ) );
			self::send_text( $chat_id, '✅ ' . esc_html__( 'گفتگو بسته شد', 'tamas-box' ) . ' #' . $session_id );
			return;
		}

		self::answer_callback( $id, '' );
		self::send_text( $chat_id, self::session_details_text( $session ) );
	}

	/**
	 * Somebody who is not an admin tried to talk to the bot.
	 *
	 * @param int $chat_id Chat.
	 * @return void
	 */
	protected static function reject_stranger( $chat_id ) {
		$key = 'tmb_chat_stranger_' . md5( (string) $chat_id );

		if ( get_transient( $key ) ) {
			return;
		}

		set_transient( $key, 1, 6 * HOUR_IN_SECONDS );

		$text = esc_html__( 'این بازو فقط برای پشتیبانی سایت استفاده می‌شود و پیام شما به کسی ارسال نمی‌شود.', 'tamas-box' )
			. "\n" . esc_html__( 'برای ارتباط با ما از وب‌سایت استفاده کنید.', 'tamas-box' );

		/* The owner has not registered any admin chat yet - help them instead. */
		if ( self::admin_chat_ids() === array() ) {
			$text = esc_html__( 'هنوز هیچ مدیری برای این بازو ثبت نشده است.', 'tamas-box' )
				. "\n" . esc_html__( 'اگر شما مدیر سایت هستید، این عدد را در «تماس باکس ← چت آنلاین ← شناسه چت مدیران» وارد کنید:', 'tamas-box' )
				. "\n<b>chat_id</b>: <code>" . esc_html( (string) $chat_id ) . '</code>';
		}

		self::send_text( $chat_id, $text, array(), true );
	}

	/**
	 * Name shown next to an agent reply.
	 *
	 * @param array $message Bale message.
	 * @return string
	 */
	protected static function agent_name( $message ) {
		if ( ! empty( $message['chat']['title'] ) ) {
			$title = sanitize_text_field( $message['chat']['title'] );
			$from  = '';

			if ( ! empty( $message['from']['first_name'] ) ) {
				$from = sanitize_text_field( $message['from']['first_name'] );
			}

			return $from ? $from . ' (' . $title . ')' : $title;
		}

		if ( ! empty( $message['from']['first_name'] ) ) {
			$name = sanitize_text_field( $message['from']['first_name'] );
			if ( ! empty( $message['from']['last_name'] ) ) {
				$name .= ' ' . sanitize_text_field( $message['from']['last_name'] );
			}
			return $name;
		}

		return '';
	}

	/**
	 * Find out which website conversation a Bale message belongs to.
	 *
	 * @param int    $chat_id Bale chat.
	 * @param array  $message Bale message.
	 * @param string $text    Text.
	 * @return array|null Session row.
	 */
	protected static function resolve_session( $chat_id, $message, $text ) {
		$c = self::cfg();

		/* 1) the admin pressed "reply" on one of our notifications */
		if ( ! empty( $message['reply_to_message']['message_id'] ) ) {
			$reply_id   = (int) $message['reply_to_message']['message_id'];
			$session_id = TMB_Chat_DB::session_for_bale_message( $chat_id, $reply_id );

			if ( $session_id ) {
				return TMB_Chat_DB::get_session( $session_id );
			}

			/* maybe they replied to another admin's message inside the group */
			$session_id = self::session_from_message_text( $message['reply_to_message'] );
			if ( $session_id ) {
				return TMB_Chat_DB::get_session( $session_id );
			}
		}

		/*
		 * 2) explicit code: "#12 text", "12: text", "12) text".
		 * A bare number followed by a space is NOT a code, otherwise a reply
		 * like "24 ساعت ديگر تماس مى‌گيريم" would be routed to session 24.
		 */
		if ( '' !== $text ) {
			$code = 0;

			if ( preg_match( '/^#\s*(\d{1,8})\b/u', $text, $matches ) ) {
				$code = (int) $matches[1];
			} elseif ( preg_match( '/^(\d{1,8})\s*[:\)]\s*/u', $text, $matches ) ) {
				$code = (int) $matches[1];
			}

			if ( $code ) {
				$session = TMB_Chat_DB::get_session( $code );
				if ( $session ) {
					return $session;
				}
			}
		}

		/* 3) fall back to the newest open conversation */
		if ( ! empty( $c['bale_default_reply'] ) ) {
			$session = TMB_Chat_DB::latest_open_session();
			if ( $session ) {
				return $session;
			}
		}

		return null;
	}

	/**
	 * Remove a leading "#12" / "12:" conversation code from an agent reply.
	 *
	 * @param string $text       Reply text.
	 * @param int    $session_id Resolved session.
	 * @return string
	 */
	protected static function strip_session_code( $text, $session_id ) {
		if ( ! $session_id || '' === $text ) {
			return $text;
		}

		if ( preg_match( '/^#\s*(\d{1,8})\s*[:\-\)]?\s*/u', $text, $matches ) && (int) $matches[1] === (int) $session_id ) {
			return trim( substr( $text, strlen( $matches[0] ) ) );
		}

		if ( preg_match( '/^(\d{1,8})\s*[:\)]\s*/u', $text, $matches ) && (int) $matches[1] === (int) $session_id ) {
			return trim( substr( $text, strlen( $matches[0] ) ) );
		}

		return $text;
	}

	/**
	 * Extract a "#12" style code from a quoted message.
	 *
	 * @param array $message Quoted Bale message.
	 * @return int Session id (0 when unknown).
	 */
	protected static function session_from_message_text( $message ) {
		if ( empty( $message['text'] ) ) {
			return 0;
		}

		if ( preg_match( '/#(\d{1,8})/u', (string) $message['text'], $matches ) ) {
			return (int) $matches[1];
		}

		return 0;
	}

	/**
	 * Does this Bale message carry a media object we understand?
	 *
	 * @param array $message Bale message.
	 * @return bool
	 */
	protected static function has_media( $message ) {
		foreach ( array( 'photo', 'voice', 'audio', 'video', 'animation', 'document', 'sticker' ) as $key ) {
			if ( ! empty( $message[ $key ] ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Turn a Bale media message into a stored attachment.
	 *
	 * @param array $message    Bale message.
	 * @param int   $session_id Local session id (upload folder).
	 * @return array
	 */
	protected static function extract_attachment( $message, $session_id ) {
		$c = self::cfg();

		if ( empty( $c['bale_media'] ) ) {
			return array();
		}

		$file_id = '';
		$type    = '';
		$name    = '';
		$size    = 0;
		$mime    = '';

		if ( ! empty( $message['photo'] ) && is_array( $message['photo'] ) ) {
			$photo   = end( $message['photo'] );
			$file_id = isset( $photo['file_id'] ) ? $photo['file_id'] : '';
			$type    = 'photo';
			$size    = isset( $photo['file_size'] ) ? (int) $photo['file_size'] : 0;
			$mime    = 'image/jpeg';
		} elseif ( ! empty( $message['voice']['file_id'] ) ) {
			$file_id = $message['voice']['file_id'];
			$type    = 'voice';
			$size    = isset( $message['voice']['file_size'] ) ? (int) $message['voice']['file_size'] : 0;
			$mime    = isset( $message['voice']['mime_type'] ) ? $message['voice']['mime_type'] : 'audio/ogg';
		} elseif ( ! empty( $message['audio']['file_id'] ) ) {
			$file_id = $message['audio']['file_id'];
			$type    = 'audio';
			$size    = isset( $message['audio']['file_size'] ) ? (int) $message['audio']['file_size'] : 0;
			$name    = isset( $message['audio']['title'] ) ? $message['audio']['title'] : '';
			$mime    = isset( $message['audio']['mime_type'] ) ? $message['audio']['mime_type'] : 'audio/mpeg';
		} elseif ( ! empty( $message['video']['file_id'] ) ) {
			$file_id = $message['video']['file_id'];
			$type    = 'video';
			$size    = isset( $message['video']['file_size'] ) ? (int) $message['video']['file_size'] : 0;
			$mime    = isset( $message['video']['mime_type'] ) ? $message['video']['mime_type'] : 'video/mp4';
		} elseif ( ! empty( $message['animation']['file_id'] ) ) {
			$file_id = $message['animation']['file_id'];
			$type    = 'gif';
			$size    = isset( $message['animation']['file_size'] ) ? (int) $message['animation']['file_size'] : 0;
			$name    = isset( $message['animation']['file_name'] ) ? $message['animation']['file_name'] : '';
			$mime    = isset( $message['animation']['mime_type'] ) ? $message['animation']['mime_type'] : 'video/mp4';
		} elseif ( ! empty( $message['document']['file_id'] ) ) {
			$file_id = $message['document']['file_id'];
			$type    = 'document';
			$size    = isset( $message['document']['file_size'] ) ? (int) $message['document']['file_size'] : 0;
			$name    = isset( $message['document']['file_name'] ) ? $message['document']['file_name'] : '';
			$mime    = isset( $message['document']['mime_type'] ) ? $message['document']['mime_type'] : '';
		} elseif ( ! empty( $message['sticker']['file_id'] ) ) {
			$file_id = $message['sticker']['file_id'];
			$type    = 'sticker';
			$size    = isset( $message['sticker']['file_size'] ) ? (int) $message['sticker']['file_size'] : 0;
			$emoji   = isset( $message['sticker']['emoji'] ) ? $message['sticker']['emoji'] : '';
			if ( '' !== $emoji ) {
				// A plain emoji needs no download at all.
				return array(
					'type'  => 'emoji',
					'emoji' => $emoji,
				);
			}
			$mime = 'image/webp';
		}

		if ( '' === $file_id ) {
			return array();
		}

		$max = 20 * MB_IN_BYTES;
		if ( $size > $max ) {
			return array(
				'type' => 'unsupported',
				'name' => $name ? $name : __( 'فایل بزرگ‌تر از حد مجاز', 'tamas-box' ),
			);
		}

		$saved = self::save_file( $file_id, absint( $session_id ), $type, $name, $mime, $size );

		if ( is_wp_error( $saved ) ) {
			return array(
				'type'  => 'unsupported',
				'name'  => $name,
				'error' => $saved->get_error_message(),
			);
		}

		return $saved;
	}

	/**
	 * Download a file from Bale into the chat uploads folder.
	 *
	 * @param string $file_id    Bale file id.
	 * @param int    $session_id Local session.
	 * @param string $type       Attachment type.
	 * @param string $name       Original name.
	 * @param string $mime       Mime type.
	 * @param int    $size       Reported size.
	 * @return array|WP_Error Attachment array.
	 */
	protected static function save_file( $file_id, $session_id, $type, $name = '', $mime = '', $size = 0 ) {
		$url = self::file_url( $file_id );

		if ( is_wp_error( $url ) ) {
			return $url;
		}

		$allowed = array(
			'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp3', 'ogg', 'oga', 'm4a', 'wav',
			'mp4', 'm4v', 'webm', 'pdf', 'txt', 'zip',
		);

		$ext = '';
		if ( $name ) {
			$ext = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		}
		if ( '' === $ext ) {
			$map = array(
				'photo'   => 'jpg',
				'voice'   => 'ogg',
				'audio'   => 'mp3',
				'video'   => 'mp4',
				'gif'     => 'mp4',
				'sticker' => 'webp',
			);
			$ext = isset( $map[ $type ] ) ? $map[ $type ] : 'bin';
		}

		if ( ! in_array( $ext, $allowed, true ) ) {
			return new WP_Error( 'tmb_bad_ext', __( 'نوع فایل مجاز نیست.', 'tamas-box' ) );
		}

		if ( ! $session_id ) {
			$session_id = 0;
		}

		$dir = TMB_Chat_DB::uploads_dir( $session_id );
		if ( ! $dir ) {
			return new WP_Error( 'tmb_no_dir', __( 'امکان ساخت پوشه فایل‌ها وجود ندارد.', 'tamas-box' ) );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$tmp = download_url( $url, 60 );
		if ( is_wp_error( $tmp ) ) {
			return $tmp;
		}

		$real_size = filesize( $tmp );
		if ( $real_size && $real_size > 20 * MB_IN_BYTES ) {
			@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
			return new WP_Error( 'tmb_too_big', __( 'حجم فایل بیش از ۲۰ مگابایت است.', 'tamas-box' ) );
		}

		$filename = wp_unique_filename( $dir, 'bale-' . time() . '-' . wp_generate_password( 6, false, false ) . '.' . $ext );
		$dest     = trailingslashit( $dir ) . $filename;

		if ( ! @rename( $tmp, $dest ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
			@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
			return new WP_Error( 'tmb_move_failed', __( 'ذخیره فایل ناموفق بود.', 'tamas-box' ) );
		}

		@chmod( $dest, 0644 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions

		return array(
			'type' => $type,
			'url'  => TMB_Chat_DB::uploads_url( $session_id ) . rawurlencode( $filename ),
			'name' => $name ? sanitize_file_name( $name ) : $filename,
			'size' => (int) $real_size,
			'mime' => $mime,
		);
	}

	/* ---------------------------------------------------------------------
	 * Commands
	 * ------------------------------------------------------------------ */

	/**
	 * Handle a /command message coming from an admin chat.
	 *
	 * @param int    $chat_id    Chat.
	 * @param string $text       Raw text.
	 * @param string $agent_name Agent display name.
	 * @param array  $message    Full message (used for reply detection).
	 * @return void
	 */
	protected static function handle_command( $chat_id, $text, $agent_name, $message ) {
		$parts = preg_split( '/\s+/', trim( $text ), 2 );
		$cmd   = strtolower( (string) $parts[0] );
		$rest  = isset( $parts[1] ) ? trim( (string) $parts[1] ) : '';

		// Strip a possible @botname suffix: /reply@mybot 12 text
		if ( false !== strpos( $cmd, '@' ) ) {
			$cmd = substr( $cmd, 0, strpos( $cmd, '@' ) );
		}

		switch ( $cmd ) {
			case '/start':
			case '/help':
				self::send_text( $chat_id, self::help_text() );
				return;

			case '/id':
				$title = isset( $message['chat']['title'] ) ? ' — ' . sanitize_text_field( $message['chat']['title'] ) : '';
				self::send_text(
					$chat_id,
					'🔑 <b>chat_id</b>: <code>' . esc_html( (string) $chat_id ) . '</code>' . esc_html( $title )
						. "\n" . esc_html__( 'این عدد را در تنظیمات افزونه (بخش چت آنلاین ← شناسه چت مدیران) وارد کنید.', 'tamas-box' )
				);
				return;

			case '/chats':
				self::send_text( $chat_id, self::open_chats_text( $rest ) );
				return;

			case '/chat':
			case '/info':
				$id = (int) preg_replace( '/\D+/', '', $rest );
				$session = $id ? TMB_Chat_DB::get_session( $id ) : null;
				self::send_text( $chat_id, $session ? self::session_details_text( $session ) : '⚠️ ' . esc_html__( 'گفتگو پیدا نشد.', 'tamas-box' ) );
				return;

			case '/reply':
			case '/r':
			case '/a':
				self::command_reply( $chat_id, $rest, $agent_name );
				return;

			case '/close':
			case '/end':
				$id = (int) preg_replace( '/\D+/', '', $rest );
				if ( ! $id ) {
					$session = TMB_Chat_DB::latest_open_session();
					$id      = $session ? (int) $session['id'] : 0;
				}
				if ( $id ) {
					TMB_Chat::set_session_status( $id, 'closed', $agent_name );
					self::send_text( $chat_id, '✅ ' . esc_html__( 'گفتگو بسته شد', 'tamas-box' ) . ' #' . $id );
				} else {
					self::send_text( $chat_id, '⚠️ ' . esc_html__( 'گفتگوی بازی وجود ندارد.', 'tamas-box' ) );
				}
				return;

			case '/open':
				$id = (int) preg_replace( '/\D+/', '', $rest );
				if ( $id && TMB_Chat_DB::get_session( $id ) ) {
					TMB_Chat::set_session_status( $id, 'open', $agent_name );
					self::send_text( $chat_id, '🔓 ' . esc_html__( 'گفتگو دوباره باز شد', 'tamas-box' ) . ' #' . $id );
				} else {
					self::send_text( $chat_id, '⚠️ ' . esc_html__( 'کد گفتگو را بنویسید، مثال: /open 12', 'tamas-box' ) );
				}
				return;

			case '/stats':
				$counters = TMB_Chat_DB::counters();
				self::send_text(
					$chat_id,
					'📊 <b>' . esc_html__( 'آمار گفتگوها', 'tamas-box' ) . '</b>'
						. "\n" . esc_html__( 'باز:', 'tamas-box' ) . ' ' . (int) $counters['open']
						. "\n" . esc_html__( 'بی‌پاسخ:', 'tamas-box' ) . ' ' . (int) $counters['unread']
				);
				return;

			case '/webhook':
				$info = self::webhook_info();
				if ( is_wp_error( $info ) ) {
					self::send_text( $chat_id, '⚠️ ' . esc_html( $info->get_error_message() ) );
					return;
				}
				$result = isset( $info['result'] ) ? $info['result'] : array();
				$line   = '🔗 <b>Webhook</b>';
				$line  .= "\nurl: <code>" . esc_html( isset( $result['url'] ) ? $result['url'] : '-' ) . '</code>';
				$line  .= "\npending: " . (int) ( isset( $result['pending_update_count'] ) ? $result['pending_update_count'] : 0 );
				if ( ! empty( $result['last_error_message'] ) ) {
					$line .= "\nlast error: " . esc_html( $result['last_error_message'] );
				}
				self::send_text( $chat_id, $line );
				return;

			default:
				self::send_text( $chat_id, self::help_text() );
				return;
		}
	}

	/**
	 * /reply <id> <text>
	 *
	 * @param int    $chat_id    Chat.
	 * @param string $rest       Arguments.
	 * @param string $agent_name Agent.
	 * @return void
	 */
	protected static function command_reply( $chat_id, $rest, $agent_name ) {
		$id = 0;

		if ( preg_match( '/^#?(\d{1,8})\s+(.*)$/us', $rest, $matches ) ) {
			$id   = (int) $matches[1];
			$rest = trim( (string) $matches[2] );
		}

		if ( ! $id ) {
			$session = TMB_Chat_DB::latest_open_session();
			$id      = $session ? (int) $session['id'] : 0;
		}

		if ( '' === $rest ) {
			self::send_text( $chat_id, '⚠️ ' . esc_html__( 'متن پاسخ خالی است. مثال:', 'tamas-box' ) . "\n<code>/reply 12 " . esc_html__( 'سلام، در خدمتیم', 'tamas-box' ) . '</code>' );
			return;
		}

		if ( ! $id || ! TMB_Chat_DB::get_session( $id ) ) {
			self::send_text( $chat_id, '⚠️ ' . esc_html__( 'گفتگو پیدا نشد.', 'tamas-box' ) );
			return;
		}

		TMB_Chat::store_agent_message( $id, $rest, array(), $agent_name, 'bale', array( 'chat_id' => $chat_id ) );

		self::send_text( $chat_id, '✅ ' . esc_html__( 'پاسخ به گفتگو', 'tamas-box' ) . ' #' . $id . ' ' . esc_html__( 'ارسال شد.', 'tamas-box' ) );
	}

	/**
	 * /chats output.
	 *
	 * @param string $limit_raw Optional number.
	 * @return string
	 */
	protected static function open_chats_text( $limit_raw = '' ) {
		$limit = (int) preg_replace( '/\D+/', '', (string) $limit_raw );
		$limit = $limit ? min( 30, $limit ) : 10;

		$list = TMB_Chat_DB::sessions_list(
			array(
				'status'   => 'open',
				'per_page' => $limit,
			)
		);

		if ( empty( $list['items'] ) ) {
			return '📭 ' . esc_html__( 'گفتگوی بازی وجود ندارد.', 'tamas-box' );
		}

		$text = '💬 <b>' . esc_html__( 'گفتگوهای باز', 'tamas-box' ) . '</b> (' . (int) $list['total'] . ")";

		foreach ( $list['items'] as $session ) {
			$text .= "\n──────";
			$text .= "\n#" . (int) $session['id'] . ' | ' . esc_html( self::session_label( $session ) );
			if ( ! empty( $session['contact'] ) ) {
				$text .= ' | ' . esc_html( $session['contact'] );
			}
			if ( (int) $session['unread_agent'] > 0 ) {
				$text .= ' | 🔴 ' . (int) $session['unread_agent'];
			}
			$text .= "\n" . esc_html( self::format_time( (int) $session['last_at'] ) );
			if ( '' !== (string) $session['last_message'] ) {
				$text .= "\n" . esc_html( $session['last_message'] );
			}
		}

		$text .= "\n──────";
		$text .= "\n" . esc_html__( 'پاسخ:', 'tamas-box' ) . ' <code>/reply 12 ' . esc_html__( 'متن', 'tamas-box' ) . '</code>';

		return $text;
	}

	/**
	 * Detailed view of one conversation.
	 *
	 * @param array $session Session row.
	 * @return string
	 */
	public static function session_details_text( $session ) {
		$id   = (int) $session['id'];
		$text = '👤 <b>#' . $id . ' — ' . esc_html( self::session_label( $session ) ) . '</b>';

		if ( ! empty( $session['contact'] ) ) {
			$text .= "\n📞 " . esc_html( $session['contact'] );
		}
		if ( ! empty( $session['page_url'] ) ) {
			$text .= "\n🔗 <a href=\"" . esc_url( $session['page_url'] ) . '">' . esc_html( self::short_url( $session['page_url'] ) ) . '</a>';
		}
		$text .= "\n🕒 " . esc_html( self::format_time( (int) $session['created_at'] ) );
		$text .= "\n" . ( 'open' === $session['status'] ? '🟢 ' . esc_html__( 'باز', 'tamas-box' ) : '⚪ ' . esc_html__( 'بسته', 'tamas-box' ) );
		$text .= "\n──────";

		$messages = TMB_Chat_DB::last_messages( $id, 8 );
		foreach ( $messages as $message ) {
			$who = 'visitor' === $message['sender'] ? '🧑 ' . self::session_label( $session ) : ( 'agent' === $message['sender'] ? '🛠 ' . __( 'پشتیبانی', 'tamas-box' ) : 'ℹ️ ' );
			$text .= "\n" . esc_html( $who ) . ': ' . esc_html( $message['body'] );
		}

		$text .= "\n──────";
		$text .= "\n" . esc_html__( 'پاسخ:', 'tamas-box' ) . ' <code>/reply ' . $id . ' ' . esc_html__( 'متن', 'tamas-box' ) . '</code>';

		return $text;
	}

	/**
	 * Help message.
	 *
	 * @return string
	 */
	protected static function help_text() {
		$text = '🤖 <b>' . esc_html__( 'بازوی گفتگوی آنلاین سایت', 'tamas-box' ) . '</b>';
		$text .= "\n\n" . esc_html__( 'هر پیامی که بازدیدکننده در سایت بنویسد، همین‌جا برای شما نمایش داده می‌شود.', 'tamas-box' );
		$text .= "\n\n<b>" . esc_html__( 'روش‌های پاسخ دادن:', 'tamas-box' ) . '</b>';
		$text .= "\n1️⃣ " . esc_html__( 'روی پیام کاربر «پاسخ/Reply» بزنید و متن را بنویسید.', 'tamas-box' );
		$text .= "\n2️⃣ " . esc_html__( 'کد گفتگو را اول پیام بنویسید:', 'tamas-box' ) . "\n<code>#12 " . esc_html__( 'متن پاسخ', 'tamas-box' ) . '</code>';
		$text .= "\n3️⃣ " . esc_html__( 'فقط متن را بنویسید؛ به آخرین گفتگوی باز ارسال می‌شود.', 'tamas-box' );

		$text .= "\n\n<b>" . esc_html__( 'دستورها:', 'tamas-box' ) . '</b>';
		$text .= "\n<code>/id</code> — " . esc_html__( 'شناسه همین چت (برای تنظیمات)', 'tamas-box' );
		$text .= "\n<code>/chats</code> — " . esc_html__( 'فهرست گفتگوهای باز', 'tamas-box' );
		$text .= "\n<code>/chat 12</code> — " . esc_html__( 'جزئیات و آخرین پیام‌های یک گفتگو', 'tamas-box' );
		$text .= "\n<code>/reply 12 متن</code> — " . esc_html__( 'ارسال پاسخ', 'tamas-box' );
		$text .= "\n<code>/close 12</code> — " . esc_html__( 'بستن گفتگو', 'tamas-box' );
		$text .= "\n<code>/open 12</code> — " . esc_html__( 'باز کردن دوباره گفتگو', 'tamas-box' );
		$text .= "\n<code>/stats</code> — " . esc_html__( 'آمار', 'tamas-box' );
		$text .= "\n<code>/webhook</code> — " . esc_html__( 'وضعیت وب‌هوک', 'tamas-box' );

		return $text;
	}

	/* ---------------------------------------------------------------------
	 * Polling fallback
	 * ------------------------------------------------------------------ */

	/**
	 * Pull pending updates with getUpdates (used when webhook mode is off or as
	 * a safety net). Throttled by a transient so it never runs twice at once.
	 *
	 * @param int $timeout Long poll timeout in seconds.
	 * @return int Number of processed updates.
	 */
	public static function pull_updates( $timeout = 20 ) {
		// A token is enough: /id must work before any admin chat is registered.
		if ( ! self::has_token() ) {
			return 0;
		}

		$lock = 'tmb_chat_pull_lock';
		if ( get_transient( $lock ) ) {
			return 0;
		}
		set_transient( $lock, 1, max( 15, $timeout + 10 ) );

		$offset = (int) TMB_Chat_DB::get_state( 'update_offset', 0 );
		$result = self::get_updates( $offset, 50, $timeout );

		delete_transient( $lock );

		if ( is_wp_error( $result ) || empty( $result['result'] ) || ! is_array( $result['result'] ) ) {
			return 0;
		}

		$processed = 0;

		foreach ( $result['result'] as $update ) {
			if ( ! is_array( $update ) ) {
				continue;
			}
			self::handle_update( $update );
			$processed++;

			if ( ! empty( $update['update_id'] ) ) {
				$offset = max( $offset, (int) $update['update_id'] + 1 );
			}
		}

		TMB_Chat_DB::set_state( 'update_offset', $offset );
		TMB_Chat_DB::set_state( 'last_poll', time() );

		return $processed;
	}
}
